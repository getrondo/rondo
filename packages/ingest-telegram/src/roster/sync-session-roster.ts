import { isNotEmptyArray } from '@rnw-community/shared';
import { lineupEntry, team, teamMember } from '@rondo/db/schema/play.schema';
import { attendance, session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, inArray, ne, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

export const syncSessionRoster = Effect.fn('IngestTelegram.syncSessionRoster')(function* (sessionIds: readonly string[]) {
    const db = yield* Db;

    if (!isNotEmptyArray(sessionIds)) {
        return;
    }

    const players = and(
        inArray(lineupEntry.sessionId, [...sessionIds]),
        sql`${lineupEntry.personId} is not null`,
        ne(lineupEntry.teamOrdinal, 0)
    );

    yield* db.delete(teamMember).where(inArray(teamMember.sessionId, [...sessionIds]));
    yield* db.execute(sql`
        insert into ${teamMember} (team_id, session_id, person_id, is_gk, is_newcomer, assigned_by)
        select distinct on (${lineupEntry.sessionId}, ${lineupEntry.personId})
            ${team.id}, ${lineupEntry.sessionId}, ${lineupEntry.personId}, ${lineupEntry.isGk}, ${lineupEntry.isNewcomer},
            (case when ${session.source} = 'import' then 'import' else 'organizer' end)::play.assigned_by
        from ${lineupEntry}
        join ${team} on ${team.sessionId} = ${lineupEntry.sessionId} and ${team.ordinal} = ${lineupEntry.teamOrdinal}
        join ${session} on ${session.id} = ${lineupEntry.sessionId}
        where ${players}
        order by ${lineupEntry.sessionId}, ${lineupEntry.personId}, ${lineupEntry.teamOrdinal}, ${lineupEntry.position}
    `);
    yield* db.delete(attendance).where(and(inArray(attendance.sessionId, [...sessionIds]), ne(attendance.source, 'manual')));
    yield* db.execute(sql`
        insert into ${attendance} (session_id, person_id, outcome, source)
        select distinct ${lineupEntry.sessionId}, ${lineupEntry.personId}, 'attended'::scheduling.attendance_outcome,
            (case when ${session.source} = 'import' then 'import' else 'bot' end)::identity.record_source
        from ${lineupEntry}
        join ${session} on ${session.id} = ${lineupEntry.sessionId}
        where ${players}
        on conflict do nothing
    `);
});
