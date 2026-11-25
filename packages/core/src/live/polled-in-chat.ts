import { messageRef } from '@rondo/db/schema/platform.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, inArray, sql, type SQL } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

const hasPollIn = (chatId: bigint): SQL => sql`(
    exists (
        select 1 from ${messageRef}
        where ${messageRef.entityId} = ${session.id} and ${messageRef.purpose} = 'poll' and ${messageRef.chatId} = ${chatId}
    ) or exists (
        select 1 from ingest.extraction found join ingest.source_ref ref on ref.id = found.source_ref_id and ref.kind = 'poll'
        where found.entity_type = 'scheduling.session' and found.entity_id = ${session.id} and ref.chat_id = ${chatId}
    )
)`;

export const polledInChat = Effect.fn('Core.polledInChat')(function* <Game extends { readonly id: string }>(
    games: readonly Game[],
    chatId: bigint
) {
    const db = yield* Db;
    const ids = games.map(({ id }) => id);
    const rows = yield* db
        .select({ id: session.id })
        .from(session)
        .where(and(inArray(session.id, ids), hasPollIn(chatId)));
    const polled = new Set(rows.map(({ id }) => id));

    return games.filter(({ id }) => polled.has(id));
});
