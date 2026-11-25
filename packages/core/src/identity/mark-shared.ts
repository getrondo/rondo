import { isNotEmptyArray } from '@rnw-community/shared';
import { personAlias } from '@rondo/db/schema/identity.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, count, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { syncSessionRoster } from '../roster/sync-session-roster';

const minRepeats = 2;

export const markShared = Effect.fn('Core.markShared')(function* (communityId: string) {
    const db = yield* Db;
    const repeated = db
        .select({ aliasId: lineupEntry.aliasId, sessionId: lineupEntry.sessionId })
        .from(lineupEntry)
        .innerJoin(personAlias, eq(personAlias.id, lineupEntry.aliasId))
        .where(
            and(
                eq(personAlias.communityId, communityId),
                eq(personAlias.kind, 'nickname'),
                eq(lineupEntry.isGuest, false),
                isNull(lineupEntry.chatId)
            )
        )
        .groupBy(lineupEntry.aliasId, lineupEntry.sessionId)
        .having(gte(count(), minRepeats))
        .as('repeated');
    const rows = yield* db.select({ aliasId: repeated.aliasId }).from(repeated).groupBy(repeated.aliasId).having(gte(count(), minRepeats));
    const aliasIds = rows.map(({ aliasId }) => aliasId ?? '');

    if (!isNotEmptyArray(aliasIds)) {
        return;
    }

    yield* db
        .update(personAlias)
        .set({
            kind: 'placeholder',
            personId: null,
            resolution: sql`case when ${personAlias.resolution} = 'guest' then ${personAlias.resolution} else 'unresolved' end`
        })
        .where(inArray(personAlias.id, aliasIds));
    const entries = yield* db
        .update(lineupEntry)
        .set({ personId: null, resolvedBy: 'guest' })
        .where(and(inArray(lineupEntry.aliasId, aliasIds), ne(lineupEntry.resolvedBy, 'manual')))
        .returning({ sessionId: lineupEntry.sessionId });
    yield* syncSessionRoster([...new Set(entries.map(({ sessionId }) => sessionId))]);
});
