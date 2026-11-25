import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { lineupEntry, team, teamMember } from '@rondo/db/schema/play.schema';
import { attendance, session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/db/service/with-community-lock';
import { and, eq, inArray, isNotNull, lt, ne } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { outAfterSquad } from '../teams/lineup-of-draft';

import type { SessionStatus } from './session.model';

const unfinishedStatuses: SessionStatus[] = ['open', 'full', 'locked'];

const isOver = (startedBefore: Date) => and(inArray(session.status, unfinishedStatuses), lt(session.startsAt, startedBefore));

const playersOf = Effect.fn('Core.playersOf')(function* (sessionId: string) {
    const db = yield* Db;
    const lineup = yield* db
        .select({ personId: lineupEntry.personId })
        .from(lineupEntry)
        .where(and(eq(lineupEntry.sessionId, sessionId), ne(lineupEntry.teamOrdinal, 0)));
    const teams = yield* db
        .select({ personId: teamMember.personId })
        .from(teamMember)
        .innerJoin(team, eq(team.id, teamMember.teamId))
        .where(and(eq(teamMember.sessionId, sessionId), isNotNull(team.publishedAt)));
    const signups = yield* db
        .select({ personId: signup.personId, isGuest: signup.isGuest, status: signup.status })
        .from(signup)
        .where(eq(signup.sessionId, sessionId));
    const excluded = new Set([...signups.filter(row => row.isGuest).map(row => row.personId), ...(yield* outAfterSquad(sessionId))]);
    const signed = signups.filter(row => row.status === 'in');
    const deciding = [teams, lineup].find(rows => isNotEmptyArray(rows)) ?? signed;
    const players = [...new Set(deciding.flatMap(({ personId }) => (isDefined(personId) && !excluded.has(personId) ? [personId] : [])))];

    return { players, excluded: [...excluded] };
});

const finishSession = Effect.fn('Core.finishSession')(function* (sessionId: string, startedBefore: Date) {
    const db = yield* Db;
    const locked = yield* db
        .select({ id: session.id })
        .from(session)
        .where(and(eq(session.id, sessionId), isOver(startedBefore)))
        .for('update');

    if (!isNotEmptyArray(locked)) {
        return false;
    }

    yield* db.update(session).set({ status: 'played' }).where(eq(session.id, sessionId));
    const { players, excluded } = yield* playersOf(sessionId);

    // Automatic attendance of guests and of who left after the squad goes, what an admin marked stays
    if (isNotEmptyArray(excluded)) {
        yield* db
            .delete(attendance)
            .where(and(eq(attendance.sessionId, sessionId), ne(attendance.source, 'manual'), inArray(attendance.personId, excluded)));
    }

    if (isNotEmptyArray(players)) {
        yield* db
            .insert(attendance)
            .values(players.map(personId => ({ sessionId, personId, outcome: 'attended' as const, source: 'bot' as const })))
            .onConflictDoNothing();
    }

    return true;
});

export const finishPastSessions = Effect.fn('Core.finishPastSessions')(function* (startedBefore: Date) {
    const db = yield* Db;
    const over = yield* db.select({ id: session.id, communityId: session.communityId }).from(session).where(isOver(startedBefore));
    const finished = yield* Effect.all(
        over.map(({ id, communityId }) =>
            withCommunityLock({ id: communityId }, finishSession(id, startedBefore)).pipe(
                Effect.tapCause(cause => Effect.logError(`[maintenance] game ${id} not finished`, cause)),
                Effect.catchCause(() => Effect.succeed(false))
            )
        )
    );

    return finished.filter(Boolean).length;
});
