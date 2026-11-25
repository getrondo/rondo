import { aliasLink, personAlias } from '@rondo/db/schema/identity.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

export interface LinkDecisions {
    readonly isRejected: (aliasId: string, personId: string, sessionIds: readonly string[]) => boolean;
    readonly hasOtherNickname: (aliasId: string, personId: string) => boolean;
}

export const loadDecisions = Effect.fn('Core.loadDecisions')(function* (communityId: string) {
    const db = yield* Db;
    const rejections = yield* db
        .selectDistinct({ aliasId: aliasLink.aliasId, personId: aliasLink.personId, sessionId: lineupEntry.sessionId })
        .from(aliasLink)
        .innerJoin(lineupEntry, eq(lineupEntry.aliasId, aliasLink.aliasId))
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .where(
            and(eq(aliasLink.communityId, communityId), eq(aliasLink.status, 'rejected'), sql`${aliasLink.during} @> ${session.localDate}`)
        );
    const approvals = yield* db
        .selectDistinct({ aliasId: aliasLink.aliasId, personId: aliasLink.personId })
        .from(aliasLink)
        .innerJoin(personAlias, eq(personAlias.id, aliasLink.aliasId))
        .where(and(eq(aliasLink.communityId, communityId), eq(aliasLink.status, 'approved'), eq(personAlias.kind, 'nickname')));
    const rejected = new Set(rejections.map(row => `${row.aliasId}|${row.personId}|${row.sessionId}`));
    const nicknames = new Map<string, Set<string>>();

    for (const { aliasId, personId } of approvals) {
        nicknames.set(personId, (nicknames.get(personId) ?? new Set()).add(aliasId));
    }

    return {
        isRejected: (aliasId, personId, sessionIds) => sessionIds.some(sessionId => rejected.has(`${aliasId}|${personId}|${sessionId}`)),
        hasOtherNickname: (aliasId, personId) => nicknames.has(personId) && nicknames.get(personId)?.has(aliasId) !== true
    } satisfies LinkDecisions;
});
