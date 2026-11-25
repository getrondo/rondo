import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { rating, ratingEvent, team, teamMember } from '@rondo/db/schema/play.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/ingest-telegram/load/with-community-lock';
import { and, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';
import { requireSession } from '../sessions/session.service';

import { rateResult } from './rate-result';
import { ratingsOf } from './team-inputs';

const correctionMs = 12 * 60 * 60_000;

const revertResult = Effect.fn('Core.revertResult')(function* (sessionId: string, isSameEvening: boolean) {
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

    if (!isSameEvening || isNotEmptyArray(later)) {
        return yield* ActionFailedError.make({ reason: 'the result is already recorded' });
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
    }) =>
        withCommunityLock(
            { id: input.communityId },
            Effect.gen(function* () {
                const db = yield* Db;
                const target = yield* requireSession(input.communityId, input.sessionId);
                const teams = yield* db.select().from(team).where(eq(team.sessionId, input.sessionId)).orderBy(asc(team.ordinal));

                if (!isNotEmptyArray(teams)) {
                    return yield* ActionFailedError.make({ reason: 'the game has no teams' });
                }

                const ranks = teams.map(entry => (!isDefined(input.winner) || entry.ordinal === input.winner ? 1 : 2));
                const recorded = yield* db
                    .select({ id: ratingEvent.id })
                    .from(ratingEvent)
                    .where(eq(ratingEvent.sessionId, input.sessionId))
                    .limit(1);
                const isCorrection = teams.some(entry => isDefined(entry.rank)) || isNotEmptyArray(recorded);

                if (isCorrection && teams.every((entry, index) => entry.rank === ranks[index])) {
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
                const members = yield* db
                    .select({
                        teamId: teamMember.teamId,
                        personId: teamMember.personId,
                        isGuest: sql<boolean>`coalesce(${signup.isGuest}, false)`
                    })
                    .from(teamMember)
                    .leftJoin(signup, and(eq(signup.sessionId, teamMember.sessionId), eq(signup.personId, teamMember.personId)))
                    .where(eq(teamMember.sessionId, input.sessionId));
                const { strengthOf } = yield* ratingsOf(
                    activityId,
                    members.map(member => member.personId)
                );
                const rosters = teams.map(entry => members.filter(member => member.teamId === entry.id));
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
