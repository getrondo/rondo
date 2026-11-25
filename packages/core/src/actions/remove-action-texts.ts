import { pendingAction } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, lt, ne, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

export const removeActionTexts = Effect.fn('Core.removeActionTexts')(function* (createdBefore: Date) {
    const db = yield* Db;
    const kept = sql`(
        select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
        from jsonb_each(${pendingAction.payload})
        where key in ('_tag', 'chatId', 'topicId', 'sessionId', 'closes')
    )`;

    yield* db
        .update(pendingAction)
        .set({ summary: '', payload: kept })
        .where(and(ne(pendingAction.status, 'proposed'), ne(pendingAction.summary, ''), lt(pendingAction.createdAt, createdBefore)));
});
