import { community } from '@rondo/db/schema/org.schema';
import { importedPoll, sourceRef } from '@rondo/db/schema/platform.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

export const moveImportedChat = Effect.fn('Core.moveImportedChat')(function* (from: number, to: number) {
    const db = yield* Db;

    yield* db.execute(sql`
        delete from ingest.source_ref old
        where old.chat_id = ${from}
          and exists (
              select 1 from ingest.source_ref kept
              where kept.chat_id = ${to} and kept.community_id = old.community_id and kept.message_id = old.message_id and kept.kind = old.kind
          )`);
    yield* db.update(sourceRef).set({ chatId: to }).where(eq(sourceRef.chatId, from));
    yield* db.update(importedPoll).set({ chatId: to }).where(eq(importedPoll.chatId, from));
    yield* db.update(lineupEntry).set({ chatId: to }).where(eq(lineupEntry.chatId, from));

    for (const path of ['{ingest,otherChats}', '{groups,chats}']) {
        yield* db
            .update(community)
            .set({
                settings: sql`jsonb_set(${community.settings}, ${path}::text[], (
                    select jsonb_agg(case when (chat ->> 'chatId')::bigint = ${from}::bigint then chat || jsonb_build_object('chatId', ${to}::bigint) else chat end)
                    from jsonb_array_elements(${community.settings} #> ${path}::text[]) chat
                ))`
            })
            .where(sql`${community.settings} #> ${path}::text[] @> jsonb_build_array(jsonb_build_object('chatId', ${from}::bigint))`);
    }
});
