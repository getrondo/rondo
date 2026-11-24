import { isDefined } from '@rnw-community/shared';
import { person, personAlias } from '@rondo/db/schema/identity.schema';
import { attendance, session } from '@rondo/db/schema/scheduling.schema';
import { venue } from '@rondo/db/schema/venue.schema';
import { Db, type Database } from '@rondo/db/service/db.service';
import { and, between, count, countDistinct, desc, eq, inArray, max, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { latestVotes } from '../signups/latest-votes';

export interface DateRange {
    readonly from: string;
    readonly to: string;
}

const playedOutcomes = ['attended', 'late', 'left_early'] as const;

const playedGames = (db: Database) =>
    db
        .select({ personId: person.id, name: person.displayName, games: count(), lastPlayed: max(session.localDate) })
        .from(attendance)
        .innerJoin(session, eq(session.id, attendance.sessionId))
        .innerJoin(person, eq(person.id, attendance.personId));

const notPlaceholder = sql`not exists (select 1 from identity.person_alias shared where shared.guest_person_id = ${person.id} and shared.kind = 'placeholder')`;

const signedUpGames = Effect.fn('Core.signedUpGames')(function* (communityId: string, personId: string) {
    const db = yield* Db;
    const vote = latestVotes(db);
    const [row] = yield* db
        .select({ games: count() })
        .from(vote)
        .innerJoin(session, eq(session.id, vote.sessionId))
        .where(and(eq(session.communityId, communityId), eq(vote.personId, personId), eq(vote.choice, 'yes')));

    return row?.games ?? 0;
});

export const attendanceCoverage = Effect.fn('Core.attendanceCoverage')(function* (communityId: string, range?: DateRange) {
    const db = yield* Db;
    const [row] = yield* db
        .select({
            playedGames: count(),
            gamesWithKnownPlayers: sql<number>`count(*) filter (where exists (select 1 from play.team_member known where known.session_id = ${session.id}))::int`
        })
        .from(session)
        .where(
            and(
                eq(session.communityId, communityId),
                eq(session.status, 'played'),
                ...(isDefined(range) ? [between(session.localDate, range.from, range.to)] : [])
            )
        );

    return row ?? { playedGames: 0, gamesWithKnownPlayers: 0 };
});

export const topAttendance = Effect.fn('Core.topAttendance')(function* (communityId: string, range: DateRange, limit: number) {
    const db = yield* Db;

    const rows = yield* playedGames(db)
        .where(
            and(
                eq(session.communityId, communityId),
                between(session.localDate, range.from, range.to),
                inArray(attendance.outcome, playedOutcomes),
                eq(session.status, 'played'),
                notPlaceholder
            )
        )
        .groupBy(person.id, person.displayName)
        .orderBy(desc(count()))
        .limit(limit);

    return rows.map(({ personId, name, games }) => ({ personId, name, games }));
});

export const inactivePlayers = Effect.fn('Core.inactivePlayers')(function* (
    communityId: string,
    input: { readonly notSince: string; readonly minGames: number; readonly limit: number }
) {
    const db = yield* Db;
    const lastPlayed = max(session.localDate);

    return yield* playedGames(db)
        .where(
            and(
                eq(session.communityId, communityId),
                inArray(attendance.outcome, playedOutcomes),
                eq(session.status, 'played'),
                notPlaceholder
            )
        )
        .groupBy(person.id, person.displayName)
        .having(and(sql`${count()} >= ${input.minGames}`, sql`${lastPlayed} < ${input.notSince}`))
        .orderBy(desc(count()))
        .limit(input.limit);
});

export const venueUsage = Effect.fn('Core.venueUsage')(function* (communityId: string, range: DateRange) {
    const db = yield* Db;

    return yield* db
        .select({
            venue: sql<string>`coalesce(${venue.name}, '—')`,
            sessions: count(),
            played: sql<number>`count(*) filter (where ${session.status} = 'played')::int`,
            cancelled: sql<number>`count(*) filter (where ${session.status} = 'cancelled')::int`
        })
        .from(session)
        .leftJoin(venue, eq(venue.id, session.venueId))
        .where(and(eq(session.communityId, communityId), between(session.localDate, range.from, range.to)))
        .groupBy(venue.name)
        .orderBy(desc(count()));
});

export const communitySummary = Effect.fn('Core.communitySummary')(function* (communityId: string, range: DateRange) {
    const db = yield* Db;
    const [sessions] = yield* db
        .select({
            sessions: count(),
            played: sql<number>`count(*) filter (where ${session.status} = 'played')::int`,
            cancelled: sql<number>`count(*) filter (where ${session.status} = 'cancelled')::int`
        })
        .from(session)
        .where(and(eq(session.communityId, communityId), between(session.localDate, range.from, range.to)));
    const [players] = yield* db
        .select({ distinctPlayers: countDistinct(attendance.personId), appearances: count() })
        .from(attendance)
        .innerJoin(session, eq(session.id, attendance.sessionId))
        .where(
            and(
                eq(session.communityId, communityId),
                between(session.localDate, range.from, range.to),
                inArray(attendance.outcome, playedOutcomes),
                eq(session.status, 'played')
            )
        );

    return { ...sessions, ...players };
});

export const playerHistory = Effect.fn('Core.playerHistory')(function* (communityId: string, personId: string) {
    const db = yield* Db;
    const [summary] = yield* db
        .select({
            games: count(),
            first: sql<string | null>`min(${session.localDate})`,
            last: sql<string | null>`max(${session.localDate})`
        })
        .from(attendance)
        .innerJoin(session, eq(session.id, attendance.sessionId))
        .where(
            and(
                eq(session.communityId, communityId),
                eq(attendance.personId, personId),
                inArray(attendance.outcome, playedOutcomes),
                eq(session.status, 'played')
            )
        );
    const aliases = yield* db
        .select({ alias: personAlias.alias, occurrences: personAlias.occurrences })
        .from(personAlias)
        .where(and(eq(personAlias.communityId, communityId), eq(personAlias.personId, personId)));

    const signedUp = yield* signedUpGames(communityId, personId);

    return { ...summary, signedUp, aliases };
});
