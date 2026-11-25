import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { lineupDelivery, team, teamColor, teamDraft, teamMember } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/db/service/with-community-lock';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';
import { addMillis } from '../utils/add-millis.util';
import { topicOptions } from '../utils/topic-options.util';

import { badgeOfColour, badgeOfRow } from './badges';
import { syncRoster } from './draft-state';
import { planLineup, type PlanInput } from './lineup-plan';
import { loadDraft } from './team-draft.service';
import { loadTeamInputs } from './team-inputs';
import { clearResult, isRevertible, resultRecorded } from './team-result';

import type { PostTeam } from './interface/lineup-post.interface';
import type { DeliveryOutcome, LineupPlan, PlannedDelivery, PublishOutcome } from './interface/publish.interface';

export const lineupChanged = 'the teams post changed after the preview';

const notModified = /message is not modified/iu;
const notFound = /message to edit not found/iu;
const htmlOptions = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

const colourIdOf = Effect.fn('Core.colourIdOf')(function* (communityId: string, colour: string) {
    const db = yield* Db;
    const rows = yield* db.select().from(teamColor).where(eq(teamColor.communityId, communityId));
    const found = rows.find(row => badgeOfRow(row)?.colour === colour);

    if (isDefined(found) || !isDefined(badgeOfColour(colour))) {
        return found?.id ?? null;
    }

    const [created] = yield* db
        .insert(teamColor)
        .values({ communityId, name: colour, emoji: badgeOfColour(colour)?.badge ?? null })
        .onConflictDoUpdate({ target: [teamColor.communityId, teamColor.name], set: { name: colour } })
        .returning({ id: teamColor.id });

    return created?.id ?? null;
});

const storeSquad = Effect.fn('Core.storeSquad')(function* (communityId: string, sessionId: string, teams: readonly PostTeam[]) {
    const db = yield* Db;
    const publishedAt = yield* DateTime.nowAsDate;
    const existing = yield* db.select({ id: team.id, ordinal: team.ordinal }).from(team).where(eq(team.sessionId, sessionId));
    yield* db.delete(team).where(and(eq(team.sessionId, sessionId), gt(team.ordinal, teams.length)));
    yield* db.delete(teamMember).where(eq(teamMember.sessionId, sessionId));

    for (const [index, posted] of teams.entries()) {
        const ordinal = index + 1;
        const colorId = yield* colourIdOf(communityId, posted.colour ?? '');
        const kept = existing.find(entry => entry.ordinal === ordinal);
        const [stored] = isDefined(kept)
            ? yield* db.update(team).set({ colorId, publishedAt }).where(eq(team.id, kept.id)).returning({ id: team.id })
            : yield* db.insert(team).values({ sessionId, ordinal, colorId, publishedAt }).returning({ id: team.id });

        if (isDefined(stored) && isNotEmptyArray(posted.members)) {
            yield* db.insert(teamMember).values(
                posted.members.map(member => ({
                    teamId: stored.id,
                    sessionId,
                    personId: member.personId,
                    isGk: member.isGk,
                    assignedBy: 'balancer' as const
                }))
            );
        }
    }

    return publishedAt;
});

const busyMs = 60_000;
const gameOver = 'the game is already over or cancelled';
const closedStatuses = new Set(['cancelled', 'played', 'moved']);

interface Claim {
    readonly delivery: PlannedDelivery;
    readonly token: string;
}

const isGameOpen = Effect.fn('Core.isGameOpenForLineup')(function* (sessionId: string) {
    const db = yield* Db;
    const [game] = yield* db.select({ status: session.status }).from(session).where(eq(session.id, sessionId));

    return isDefined(game) && !closedStatuses.has(game.status);
});

const claimPublish = Effect.fn('Core.claimPublish')(function* (sessionId: string, now: Date) {
    const db = yield* Db;
    const [claimed] = yield* db
        .update(teamDraft)
        .set({ publishToken: sql`gen_random_uuid()`, publishAt: now })
        .where(
            and(eq(teamDraft.sessionId, sessionId), or(isNull(teamDraft.publishToken), lte(teamDraft.publishAt, addMillis(now, -busyMs))))
        )
        .returning({ token: teamDraft.publishToken });

    return claimed?.token ?? null;
});

const claimDelivery = Effect.fn('Core.claimLineupDelivery')(function* (sessionId: string, delivery: PlannedDelivery, now: Date) {
    const db = yield* Db;

    if (!isDefined(delivery.stored)) {
        const [inserted] = yield* db
            .insert(lineupDelivery)
            .values({ sessionId, chatId: delivery.chatId, topicId: delivery.topicId, status: 'claimed', updatedAt: now })
            .onConflictDoNothing()
            .returning({ token: lineupDelivery.token });

        return inserted?.token ?? null;
    }

    const [claimed] = yield* db
        .update(lineupDelivery)
        .set({ status: 'claimed', token: sql`gen_random_uuid()`, updatedAt: now })
        .where(
            and(
                eq(lineupDelivery.sessionId, sessionId),
                eq(lineupDelivery.chatId, delivery.chatId),
                eq(lineupDelivery.token, delivery.token ?? '')
            )
        )
        .returning({ token: lineupDelivery.token });

    return claimed?.token ?? null;
});

const sendOne = (delivery: PlannedDelivery) =>
    Effect.gen(function* () {
        const telegram = yield* Telegram;
        const chatId = Number(delivery.chatId);
        const { messageId } = delivery;

        if (isDefined(messageId)) {
            yield* telegram.call('editMessageText', api => api.editMessageText(chatId, messageId, delivery.html, htmlOptions));

            return { messageId, status: 'edited' as const };
        }

        const sent = yield* telegram.call('sendMessage', api =>
            api.sendMessage(chatId, delivery.html, { ...htmlOptions, ...topicOptions(delivery) })
        );

        return { messageId: sent.message_id, status: 'sent' as const };
    });

const deliverOne = Effect.fn('Core.deliverLineup')(function* (communityId: string, sessionId: string, claim: Claim, publishToken: string) {
    const db = yield* Db;
    const { delivery } = claim;
    const where = and(
        eq(lineupDelivery.sessionId, sessionId),
        eq(lineupDelivery.chatId, delivery.chatId),
        eq(lineupDelivery.token, claim.token)
    );
    const outcome = (status: DeliveryOutcome['status'], reason: string | null): DeliveryOutcome => ({
        chatId: delivery.chatId,
        title: delivery.title,
        status,
        reason,
        isEdit: isDefined(delivery.messageId)
    });
    const send = sendOne(delivery).pipe(
        Effect.flatMap(done =>
            db
                .update(lineupDelivery)
                .set({ status: 'sent', messageId: done.messageId, text: delivery.text, topicId: delivery.topicId })
                .where(where)
                .pipe(Effect.as(outcome(done.status, null)))
        ),
        Effect.catchTag('TelegramApiError', error => {
            if (notModified.test(error.description)) {
                return db
                    .update(lineupDelivery)
                    .set({ status: 'sent', text: delivery.text })
                    .where(where)
                    .pipe(Effect.as(outcome('edited', null)));
            }

            const status = error.isUncertain ? 'uncertain' : 'refused';
            const isGone = notFound.test(error.description);
            const isKept = status === 'refused' && isDefined(delivery.messageId) && !isGone;

            // A refused send as a new message keeps the id of the message that is still in the group
            return db
                .update(lineupDelivery)
                .set({ status: isKept ? 'sent' : status, ...(isGone ? { messageId: null } : {}) })
                .where(where)
                .pipe(Effect.as(outcome(status, error.description)));
        })
    );
    const checked = Effect.gen(function* () {
        const [draft] = yield* db.select({ token: teamDraft.publishToken }).from(teamDraft).where(eq(teamDraft.sessionId, sessionId));
        const [own] = yield* db.select({ token: lineupDelivery.token }).from(lineupDelivery).where(where);

        if (draft?.token !== publishToken || !isDefined(own)) {
            return outcome('busy', null);
        }

        if (!(yield* isGameOpen(sessionId))) {
            yield* db
                .update(lineupDelivery)
                .set({ status: isDefined(delivery.messageId) ? 'sent' : 'refused' })
                .where(where);

            return outcome('refused', gameOver);
        }

        return yield* send;
    });

    return yield* withCommunityLock({ id: communityId }, checked).pipe(
        Effect.catchCause(cause => Effect.logError('[teams] lineup receipt not saved', cause).pipe(Effect.as(outcome('uncertain', null))))
    );
});

// Someone joined or left since the screen was drawn, or a newcomer is not placed yet: the admin sees the change first
const isRosterMoved = Effect.fn('Core.isRosterMoved')(function* (communityId: string, sessionId: string) {
    const row = yield* loadDraft(sessionId);

    if (Option.isNone(row)) {
        return false;
    }

    const { state } = row.value;
    const inputs = yield* loadTeamInputs(communityId, sessionId);

    return (
        isNotEmptyArray(state.pending) ||
        syncRoster(
            state,
            inputs.members.map(member => member.personId)
        ) !== state
    );
});

const startPublish = Effect.fn('Core.startPublish')(function* (
    input: PlanInput & { readonly version: number; readonly fingerprint: string }
) {
    const plan = yield* planLineup(input);
    const now = yield* DateTime.nowAsDate;

    if (
        plan.version !== input.version ||
        plan.fingerprint !== input.fingerprint ||
        (yield* isRosterMoved(input.communityId, input.sessionId))
    ) {
        return yield* ActionFailedError.make({ reason: lineupChanged });
    }

    if (!(yield* isGameOpen(input.sessionId))) {
        return yield* ActionFailedError.make({ reason: gameOver });
    }

    if (plan.clearsResult && !(yield* isRevertible(input.sessionId)).isRevertible) {
        return yield* ActionFailedError.make({ reason: resultRecorded });
    }

    const token = yield* claimPublish(input.sessionId, now);
    const claims: Claim[] = [];

    for (const delivery of isDefined(token) ? plan.deliveries.filter(entry => entry.isDue) : []) {
        const claimed = yield* claimDelivery(input.sessionId, delivery, now);

        if (isDefined(claimed)) {
            claims.push({ delivery, token: claimed });
        }
    }

    return { plan, claims, token };
});

const waitingOutcome = (delivery: PlannedDelivery): DeliveryOutcome => {
    const quiet = delivery.stored === 'claimed' || delivery.stored === 'uncertain' ? 'uncertain' : 'unchanged';

    return {
        chatId: delivery.chatId,
        title: delivery.title,
        status: delivery.isDue || delivery.stored === 'busy' ? 'busy' : quiet,
        reason: null,
        isEdit: false
    };
};

const finishPublish = Effect.fn('Core.finishPublish')(function* (
    input: { readonly communityId: string; readonly sessionId: string; readonly actorPersonId: string | null },
    published: { readonly plan: LineupPlan; readonly token: string; readonly delivered: readonly DeliveryOutcome[] }
) {
    const db = yield* Db;
    const released = yield* db
        .update(teamDraft)
        .set({ publishToken: null, publishAt: null })
        .where(and(eq(teamDraft.sessionId, input.sessionId), eq(teamDraft.publishToken, published.token)))
        .returning({ sessionId: teamDraft.sessionId });
    const isStored = isNotEmptyArray(released) && published.delivered.some(entry => entry.status === 'sent' || entry.status === 'edited');

    if (!isStored) {
        return;
    }

    if (published.plan.clearsResult) {
        yield* clearResult(input.sessionId);
    }

    const publishedAt = yield* storeSquad(input.communityId, input.sessionId, published.plan.teams);
    yield* db.update(teamDraft).set({ publishedAt }).where(eq(teamDraft.sessionId, input.sessionId));
    yield* recordAudit({
        communityId: input.communityId,
        actorPersonId: input.actorPersonId,
        action: 'teams.publish',
        entityType: 'session',
        entityId: input.sessionId,
        diff: { delivered: published.delivered.map(entry => entry.status) }
    });
});

export const publishLineup = Effect.fn('Core.publishLineup')(function* (
    input: PlanInput & { readonly version: number; readonly fingerprint: string; readonly actorPersonId: string | null }
) {
    const { plan, claims, token } = yield* withCommunityLock({ id: input.communityId }, startPublish(input));
    const delivered: DeliveryOutcome[] = [];

    for (const claim of isDefined(token) ? claims : []) {
        const outcome = yield* deliverOne(input.communityId, input.sessionId, claim, token ?? '');
        delivered.push(outcome);
    }

    if (isDefined(token)) {
        yield* withCommunityLock({ id: input.communityId }, finishPublish(input, { plan, token, delivered })).pipe(
            Effect.catchCause(cause =>
                Effect.logError('[teams] sent but not saved', cause).pipe(
                    Effect.andThen(ActionFailedError.make({ reason: 'the teams were sent but may not be saved, check the chat' }))
                )
            )
        );
    }

    return {
        deliveries: plan.deliveries.map(
            delivery => delivered[claims.findIndex(claim => claim.delivery === delivery)] ?? waitingOutcome(delivery)
        ),
        diff: plan.diff
    } satisfies PublishOutcome;
});
