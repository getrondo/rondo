import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { rating, ratingEvent, team } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/db/service/with-community-lock';
import { and, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';
import { requireSession } from '../sessions/session.service';
import { markedNoShows } from '../signups/roster.service';

import { outAfterSquad, squadFingerprint, squadOf } from './lineup-of-draft';
import { rateResult } from './rate-result';
import { ratingsOf } from './team-inputs';

const correctionMs = 12 * 60 * 60_000;

// Who played: the squad without sign-ups that are out and without no-shows an admin marked
const playedSquad = Effect.fn('Core.playedSquad')(function* (sessionId: string) {
    const members = yield* squadOf(sessionId);
    const gone = new Set([...(yield* outAfterSquad(sessionId)), ...(yield* markedNoShows(sessionId))]);

    return members.filter(member => !gone.has(member.personId));
});

// A result can be taken back only while none of its players has a later rated game
export const isRevertible = Effect.fn('Core.isRevertible')(function* (sessionId: string) {
    const db = yield* Db;
    const events = yield* db.select().from(ratingEvent).where(eq(ratingEvent.sessionId, sessionId));
    const later = isNotEmptyArray(events)
        ? yield* db
              .select({ id: ratingEvent.id })
              .from(ratingEvent)
              .where(
                  and(
                      inArray(
                          ratingEvent.personId,
                          events.map(event => event.personId)
                      ),
                      ne(ratingEvent.sessionId, sessionId),
                      gt(
                          ratingEvent.at,
                          sql`(select max(own.at) from play_private.rating_event own where own.session_id = ${sessionId}::uuid)`
                      )
                  )
              )
              .limit(1)
        : [];

    return { events, isRevertible: !isNotEmptyArray(later) };
});

const revertResult = Effect.fn('Core.revertResult')(function* (sessionId: string, isSameEvening: boolean) {
    const db = yield* Db;
    const { events, isRevertible: canRevert } = yield* isRevertible(sessionId);

    if (!isSameEvening || !canRevert) {
        return yield* ActionFailedError.make({ failure: { code: 'result_recorded' } });
    }

    for (const event of events) {
        yield* db
            .update(rating)
            .set({ mu: event.muBefore, sigma: event.sigmaBefore, games: sql`greatest(${rating.games} - 1, 0)` })
            .where(and(eq(rating.personId, event.personId), eq(rating.activityId, event.activityId), eq(rating.model, event.model)));
    }

    yield* db.delete(ratingEvent).where(eq(ratingEvent.sessionId, sessionId));

    return events.length;
});

export const clearResult = Effect.fn('Core.clearResult')(function* (sessionId: string) {
    const db = yield* Db;
    yield* revertResult(sessionId, true);
    yield* db.update(team).set({ rank: null }).where(eq(team.sessionId, sessionId));
});

export const recordResult = Effect.fn('Core.recordResult')(
    (input: {
        readonly communityId: string;
        readonly sessionId: string;
        readonly winner: number | null;
        readonly actorPersonId: string | null;
        readonly now: Date;
        readonly squad?: string | null;
    }) =>
        withCommunityLock(
            { id: input.communityId },
            Effect.gen(function* () {
                const db = yield* Db;
                const target = yield* requireSession(input.communityId, input.sessionId);
                const members = yield* playedSquad(input.sessionId);
                const teams = (yield* db.select().from(team).where(eq(team.sessionId, input.sessionId)).orderBy(asc(team.ordinal))).filter(
                    entry => members.some(member => member.ordinal === entry.ordinal)
                );

                if (target.status === 'cancelled' || target.status === 'moved') {
                    return yield* ActionFailedError.make({ failure: { code: 'game_over' } });
                }

                if (isDefined(input.squad) && input.squad !== (yield* squadFingerprint(input.sessionId))) {
                    return yield* ActionFailedError.make({ failure: { code: 'squad_changed' } });
                }

                if (input.now.getTime() < target.startsAt.getTime()) {
                    return yield* ActionFailedError.make({ failure: { code: 'game_not_started' } });
                }

                if (!isNotEmptyArray(teams)) {
                    return yield* ActionFailedError.make({ failure: { code: 'no_teams' } });
                }

                if (isDefined(input.winner) && !teams.some(entry => entry.ordinal === input.winner)) {
                    return yield* ActionFailedError.make({ failure: { code: 'team_not_found' } });
                }

                const ranks = teams.map(entry => (!isDefined(input.winner) || entry.ordinal === input.winner ? 1 : 2));
                const recorded = yield* db
                    .select({ personId: ratingEvent.personId })
                    .from(ratingEvent)
                    .where(eq(ratingEvent.sessionId, input.sessionId));
                const isCorrection = teams.some(entry => isDefined(entry.rank)) || isNotEmptyArray(recorded);
                // The same winner is recounted when who played changed since it was rated
                const players = members.filter(member => !member.isGuest);
                const isSameRoster =
                    players.length === recorded.length && players.every(member => recorded.some(row => row.personId === member.personId));

                if (isCorrection && isSameRoster && teams.every((entry, index) => entry.rank === ranks[index])) {
                    return { ranks, isCorrection: false };
                }

                if (isCorrection) {
                    yield* revertResult(input.sessionId, input.now.getTime() <= target.startsAt.getTime() + correctionMs);
                }

                for (const [index, entry] of teams.entries()) {
                    yield* db.update(team).set({ rank: ranks[index] }).where(eq(team.id, entry.id));
                }

                const [game] = yield* db.select({ activityId: session.activityId }).from(session).where(eq(session.id, input.sessionId));
                const activityId = game?.activityId ?? '';
                const { strengthOf } = yield* ratingsOf(
                    activityId,
                    members.map(member => member.personId)
                );
                const rosters = teams.map(entry => members.filter(member => member.ordinal === entry.ordinal));
                const rated = rateResult(
                    rosters.map(roster => roster.map(member => strengthOf(member.personId))),
                    ranks
                );

                for (const [index, roster] of rosters.entries()) {
                    for (const [position, member] of roster.entries()) {
                        const before = strengthOf(member.personId);
                        const after = rated[index]?.[position] ?? before;

                        if (!member.isGuest) {
                            yield* db
                                .insert(rating)
                                .values({
                                    personId: member.personId,
                                    activityId,
                                    model: 'openskill_pl',
                                    mu: after.mu,
                                    sigma: after.sigma,
                                    games: 1
                                })
                                .onConflictDoUpdate({
                                    target: [rating.personId, rating.activityId, rating.model],
                                    set: { mu: after.mu, sigma: after.sigma, games: sql`${rating.games} + 1` }
                                });
                            yield* db.insert(ratingEvent).values({
                                personId: member.personId,
                                activityId,
                                model: 'openskill_pl',
                                sessionId: input.sessionId,
                                muBefore: before.mu,
                                muAfter: after.mu,
                                sigmaBefore: before.sigma,
                                sigmaAfter: after.sigma
                            });
                        }
                    }
                }

                yield* recordAudit({
                    communityId: input.communityId,
                    actorPersonId: input.actorPersonId,
                    action: 'teams.result',
                    entityType: 'session',
                    entityId: input.sessionId,
                    diff: { winner: input.winner, isCorrection }
                });

                return { ranks, isCorrection };
            })
        )
);
