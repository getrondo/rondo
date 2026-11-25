import { community, telegramChat } from '@rondo/db/schema/org.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, eq, notInArray } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import type { CommunityConfig } from '../config/community-config';

export const mainChatId = Effect.fn('IngestTelegram.mainChatId')(function* ({ slug, otherChats = [] }: CommunityConfig) {
    const db = yield* Db;
    const others = otherChats.map(({ chatId }) => BigInt(chatId));
    const [row] = yield* db
        .select({ chatId: telegramChat.chatId })
        .from(telegramChat)
        .innerJoin(community, eq(community.id, telegramChat.communityId))
        .where(and(eq(community.slug, slug), eq(telegramChat.purpose, 'main'), notInArray(telegramChat.chatId, others)))
        .orderBy(asc(telegramChat.createdAt), asc(telegramChat.chatId))
        .limit(1);

    return Option.fromNullishOr(row).pipe(Option.map(({ chatId }) => Number(chatId)));
});
