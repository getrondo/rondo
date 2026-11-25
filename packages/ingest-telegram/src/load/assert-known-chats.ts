import { isNotEmptyArray } from '@rnw-community/shared';
import { Db } from '@rondo/db/service/db.service';
import { sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { UnknownChatError } from '../error/unknown-chat.error';

import { mainChatId } from './main-chat-id';

import type { CommunityConfig } from '@rondo/core/config/community-config';

const StoredChatsSchema = Schema.Struct({ rows: Schema.Array(Schema.Struct({ chat_id: Schema.FiniteFromString })) });

export const assertKnownChats = Effect.fn('IngestTelegram.assertKnownChats')(function* (config: CommunityConfig) {
    const db = yield* Db;
    const { slug, otherChats = [] } = config;
    const mainId = yield* mainChatId(config);
    const result = yield* db.execute(sql`
        with home as (select id from org.community where slug = ${slug})
        select distinct stored.chat_id::text as chat_id from (
            select chat_id from ingest.source_ref where community_id in (select id from home)
            union all select chat_id from comms.imported_poll where community_id in (select id from home)
            union all select entry.chat_id from play.lineup_entry entry
                join scheduling.session game on game.id = entry.session_id where game.community_id in (select id from home)
        ) stored
        where stored.chat_id is not null
    `);
    const { rows } = yield* Schema.decodeUnknownEffect(StoredChatsSchema)(result);
    const known = new Set([...Option.toArray(mainId), ...otherChats.map(({ chatId }) => chatId)]);
    const chatIds = rows.map(row => row.chat_id).filter(chatId => !known.has(chatId));

    return yield* isNotEmptyArray(chatIds) ? UnknownChatError.make({ chatIds }) : Effect.void;
});
