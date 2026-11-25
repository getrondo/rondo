import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { lineupDelivery, team, teamColor, teamDraft, teamMember } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/db/service/with-community-lock';
import { and, eq, gt, sql } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Ref from 'effect/Ref';

import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';

import { badgeOfColour, badgeOfRow } from './badges';
import { deliverOne, isGameOpen, type Claim } from './deliver-lineup';
import { syncRoster } from './draft-state';
import { planLineup, type PlanInput } from './lineup-plan';
import { claimPublish, ownPublish } from './publish-claim';
import { loadDraft } from './team-draft.service';
import { loadTeamInputs } from './team-inputs';
import { clearResult, isRevertible, resultMark } from './team-result';

import type { Approval } from '../telegram/write-to-chat';
import type { PostTeam } from './interface/lineup-post.interface';
import type { DeliveryOutcome, LineupPlan, PlannedDelivery, PublishOutcome } from './interface/publish.interface';

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
        return yield* ActionFailedError.make({ failure: { code: 'lineup_changed' } });
    }

    if (!(yield* isGameOpen(input.sessionId))) {
        return yield* ActionFailedError.make({ failure: { code: 'game_over' } });
    }

    if (plan.clearsResult && !(yield* isRevertible(input.sessionId)).isRevertible) {
        return yield* ActionFailedError.make({ failure: { code: 'result_recorded' } });
    }

    const token = yield* claimPublish(input.sessionId, now);
    const claims: Claim[] = [];

    for (const delivery of isDefined(token) ? plan.deliveries.filter(entry => entry.isDue) : []) {
        const claimed = yield* claimDelivery(input.sessionId, delivery, now);

        if (isDefined(claimed)) {
            claims.push({ delivery, token: claimed });
        }
    }

    return { plan, claims, token, before: yield* resultMark(input.sessionId) };
});

const waitingOutcome = (delivery: PlannedDelivery): DeliveryOutcome => {
    const quiet = delivery.stored === 'claimed' || delivery.stored === 'uncertain' ? 'uncertain' : 'unchanged';

    return {
        chatId: delivery.chatId,
        title: delivery.title,
        status: delivery.isDue || delivery.stored === 'busy' ? 'busy' : quiet,
        failure: null,
        isEdit: false
    };
};

interface Squad {
    readonly plan: LineupPlan;
    readonly token: string;
    readonly before: string;
}

type SquadOutcome = 'stored' | 'taken' | 'closed' | 'changed';

// Runs in the transaction of the first receipt, so a posted line-up and its squad are never one without the other
const storeApproved = Effect.fn('Core.storeApprovedSquad')(function* (
    input: { readonly communityId: string; readonly sessionId: string; readonly actorPersonId: string | null },
    { plan, token, before }: Squad
) {
    const db = yield* Db;
    const now = yield* DateTime.nowAsDate;
    const [own] = yield* db.select({ sessionId: teamDraft.sessionId }).from(teamDraft).where(ownPublish(input.sessionId, token));

    if (!isDefined(own)) {
        return 'taken' satisfies SquadOutcome;
    }

    if (!(yield* isGameOpen(input.sessionId))) {
        return 'closed' satisfies SquadOutcome;
    }

    if ((yield* resultMark(input.sessionId)) !== before || (plan.clearsResult && !(yield* isRevertible(input.sessionId)).isRevertible)) {
        return 'changed' satisfies SquadOutcome;
    }

    if (plan.clearsResult) {
        yield* clearResult(input.sessionId);
    }

    yield* storeSquad(input.communityId, input.sessionId, plan.teams);
    yield* db.update(teamDraft).set({ publishedAt: now }).where(eq(teamDraft.sessionId, input.sessionId));
    yield* recordAudit({
        communityId: input.communityId,
        actorPersonId: input.actorPersonId,
        action: 'teams.publish',
        entityType: 'session',
        entityId: input.sessionId,
        diff: { due: plan.deliveries.filter(entry => entry.isDue).length }
    });

    return 'stored' satisfies SquadOutcome;
});

const releasePublish = Effect.fn('Core.releasePublish')(function* (sessionId: string, token: string) {
    const db = yield* Db;
    yield* db.update(teamDraft).set({ publishToken: null, publishAt: null }).where(ownPublish(sessionId, token));
});

const isPosted = (outcome: DeliveryOutcome): boolean => outcome.status === 'sent' || outcome.status === 'edited';

const deliverAll = Effect.fn('Core.deliverLineups')(function* (
    input: Parameters<typeof storeApproved>[0] & { readonly approval: Approval | null },
    squad: Squad,
    claims: readonly Claim[]
) {
    const approved = yield* Ref.make<SquadOutcome | null>(null);
    const approve = storeApproved(input, squad).pipe(Effect.flatMap(outcome => Ref.set(approved, outcome)));
    const delivered: DeliveryOutcome[] = [];

    for (const claim of claims) {
        const outcome = yield* deliverOne({
            ...input,
            claim,
            publishToken: squad.token,
            onPosted: delivered.some(entry => isPosted(entry)) ? Effect.void : approve
        });
        delivered.push(outcome);
    }

    yield* releasePublish(input.sessionId, squad.token).pipe(
        Effect.catchCause(cause => Effect.logError('[teams] claim not released', cause))
    );

    return delivered.some(entry => isPosted(entry)) && (yield* Ref.get(approved)) === 'changed'
        ? yield* ActionFailedError.make({ failure: { code: 'teams_unsaved' } })
        : delivered;
});

export const publishLineup = Effect.fn('Core.publishLineup')(function* (
    input: PlanInput & {
        readonly version: number;
        readonly fingerprint: string;
        readonly actorPersonId: string | null;
        readonly approval: Approval | null;
    }
) {
    const { plan, claims, token, before } = yield* withCommunityLock({ id: input.communityId }, startPublish(input));
    const delivered = isDefined(token) ? yield* deliverAll(input, { plan, token, before }, claims) : [];

    return {
        deliveries: plan.deliveries.map(
            delivery => delivered[claims.findIndex(claim => claim.delivery === delivery)] ?? waitingOutcome(delivery)
        ),
        diff: plan.diff
    } satisfies PublishOutcome;
});
