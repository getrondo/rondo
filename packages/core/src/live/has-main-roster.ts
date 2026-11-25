import { isNotEmptyArray } from '@rnw-community/shared';
import { lineupEntry, teamMember } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, gt, isNull } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

export const hasMainRoster = Effect.fn('Core.hasMainRoster')(function* (sessionId: string) {
    const db = yield* Db;
    const squad = yield* db
        .select({ id: lineupEntry.id })
        .from(lineupEntry)
        .where(and(eq(lineupEntry.sessionId, sessionId), isNull(lineupEntry.chatId), gt(lineupEntry.teamOrdinal, 0)))
        .limit(1);
    const published = yield* db
        .select({ teamId: teamMember.teamId })
        .from(teamMember)
        .where(and(eq(teamMember.sessionId, sessionId), eq(teamMember.assignedBy, 'balancer')))
        .limit(1);

    return isNotEmptyArray([...squad, ...published]);
});
