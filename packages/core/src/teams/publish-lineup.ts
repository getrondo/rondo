import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { lineupDelivery, team, teamColor, teamDraft, teamMember } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/ingest-telegram/load/with-community-lock';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import { and, eq, gt, sql } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';

import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';
import { topicOptions } from '../utils/topic-options.util';

import { badgeOfColour, badgeOfRow } from './badges';
import { planLineup, type PlanInput } from './lineup-plan';
import { clearResult } from './team-result';

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

const claimDelivery = Effect.fn('Core.claimLineupDelivery')(function* (sessionId: string, delivery: PlannedDelivery) {
    const db = yield* Db;

    if (!isDefined(delivery.stored)) {
        const inserted = yield* db
            .insert(lineupDelivery)
            .values({ sessionId, chatId: delivery.chatId, topicId: delivery.topicId, status: 'claimed' })
            .onConflictDoNothing()
            .returning({ chatId: lineupDelivery.chatId });

        return isNotEmptyArray(inserted);
    }

    const claimed = yield* db
        .update(lineupDelivery)
        .set({ status: 'claimed', token: sql`gen_random_uuid()` })
        .where(
            and(
                eq(lineupDelivery.sessionId, sessionId),
                eq(lineupDelivery.chatId, delivery.chatId),
                eq(lineupDelivery.status, delivery.stored),
                eq(lineupDelivery.token, delivery.token ?? '')
            )
        )
        .returning({ chatId: lineupDelivery.chatId });

    return isNotEmptyArray(claimed);
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

const deliverOne = Effect.fn('Core.deliverLineup')(function* (communityId: string, sessionId: string, delivery: PlannedDelivery) {
    const db = yield* Db;
    const where = and(eq(lineupDelivery.sessionId, sessionId), eq(lineupDelivery.chatId, delivery.chatId));
    const outcome = (status: DeliveryOutcome['status'], reason: string | null): DeliveryOutcome => ({
        chatId: delivery.chatId,
        title: delivery.title,
        status,
        reason,
        isEdit: isDefined(delivery.messageId)
    });
    const receipt = sendOne(delivery).pipe(
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

            return db
                .update(lineupDelivery)
                .set({ status: isKept ? 'sent' : status, messageId: isGone ? null : delivery.messageId })
                .where(where)
                .pipe(Effect.as(outcome(status, error.description)));
        })
    );

    return yield* withCommunityLock({ id: communityId }, receipt).pipe(
        Effect.catchCause(cause => Effect.logError('[teams] lineup receipt not saved', cause).pipe(Effect.as(outcome('uncertain', null))))
    );
});

const startPublish = Effect.fn('Core.startPublish')(function* (
    input: PlanInput & { readonly version: number; readonly fingerprint: string }
) {
    const plan = yield* planLineup(input);

    if (plan.version !== input.version || plan.fingerprint !== input.fingerprint) {
        return yield* ActionFailedError.make({ reason: lineupChanged });
    }

    if (plan.clearsResult) {
        yield* clearResult(input.sessionId);
    }

    const claimed: PlannedDelivery[] = [];

    for (const delivery of plan.deliveries.filter(entry => entry.isDue)) {
        if (yield* claimDelivery(input.sessionId, delivery)) {
            claimed.push(delivery);
        }
    }

    return { plan, claimed };
});

const waitingOutcome = (delivery: PlannedDelivery): DeliveryOutcome => {
    const quiet = delivery.stored === 'claimed' || delivery.stored === 'uncertain' ? 'uncertain' : 'unchanged';

    return { chatId: delivery.chatId, title: delivery.title, status: delivery.isDue ? 'busy' : quiet, reason: null, isEdit: false };
};

const finishPublish = Effect.fn('Core.finishPublish')(function* (
    input: { readonly communityId: string; readonly sessionId: string; readonly actorPersonId: string | null },
    plan: LineupPlan,
    delivered: readonly DeliveryOutcome[]
) {
    const db = yield* Db;
    const publishedAt = yield* storeSquad(input.communityId, input.sessionId, plan.teams);
    yield* db.update(teamDraft).set({ publishedAt }).where(eq(teamDraft.sessionId, input.sessionId));
    yield* recordAudit({
        communityId: input.communityId,
        actorPersonId: input.actorPersonId,
        action: 'teams.publish',
        entityType: 'session',
        entityId: input.sessionId,
        diff: { delivered: delivered.map(entry => entry.status) }
    });
});

export const publishLineup = Effect.fn('Core.publishLineup')(function* (
    input: PlanInput & { readonly version: number; readonly fingerprint: string; readonly actorPersonId: string | null }
) {
    const { plan, claimed } = yield* withCommunityLock({ id: input.communityId }, startPublish(input));
    const delivered: DeliveryOutcome[] = [];

    for (const delivery of claimed) {
        const outcome = yield* deliverOne(input.communityId, input.sessionId, delivery);
        delivered.push(outcome);
    }

    const isStored = delivered.some(entry => entry.status !== 'refused');

    if (isStored) {
        yield* withCommunityLock({ id: input.communityId }, finishPublish(input, plan, delivered)).pipe(
            Effect.catchCause(cause =>
                Effect.logError('[teams] sent but not saved', cause).pipe(
                    Effect.andThen(ActionFailedError.make({ reason: 'the teams were sent but may not be saved, check the chat' }))
                )
            )
        );
    }

    return {
        deliveries: plan.deliveries.map(delivery => {
            const index = claimed.indexOf(delivery);

            return delivered[index] ?? waitingOutcome(delivery);
        }),
        diff: plan.diff
    } satisfies PublishOutcome;
});
