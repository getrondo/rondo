import { isDefined } from '@rnw-community/shared';
import { extraction, messageRef, sourceRef } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, inArray } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { linkedChatsOf } from '../community/community.repository';

import type { GroupMessage } from './live-ingest';
import type { CommunityConfig } from '@rondo/ingest-telegram/config/community-config';

interface PostingChat {
    readonly communityId: string;
    readonly config: CommunityConfig;
    readonly chatId: GroupMessage['chatId'];
}

// Games posted in this chat. Games without a poll belong to the chats that have no match rules
export const gamesOfChat = Effect.fn('Core.gamesOfChat')(function* <Game extends { readonly id: string }>(
    games: readonly Game[],
    { communityId, config, chatId }: PostingChat
) {
    const db = yield* Db;
    const ids = games.map(({ id }) => id);
    const live = yield* db
        .select({ sessionId: messageRef.entityId, chatId: messageRef.chatId, kind: messageRef.purpose })
        .from(messageRef)
        .where(and(inArray(messageRef.entityId, ids), inArray(messageRef.purpose, ['poll', 'lineup'])));
    const imported = yield* db
        .select({ sessionId: extraction.entityId, chatId: sourceRef.chatId, kind: sourceRef.kind })
        .from(extraction)
        .innerJoin(sourceRef, eq(sourceRef.id, extraction.sourceRefId))
        .where(and(inArray(extraction.entityId, ids), inArray(sourceRef.kind, ['poll', 'lineup'])));
    const otherIds = new Set((config.otherChats ?? []).map(other => BigInt(other.chatId)));
    const main = (yield* linkedChatsOf(communityId)).find(chat => !otherIds.has(chat.chatId));
    const isOther = otherIds.has(chatId);
    const isMain = !isOther && (!isDefined(main) || main.chatId === chatId);
    const isOwn = (post: { readonly chatId: bigint | number | null }): boolean =>
        isDefined(post.chatId) ? BigInt(post.chatId) === chatId : isMain;

    return games.filter(({ id }) => {
        const posts = [...live, ...imported].filter(({ sessionId }) => sessionId === id);

        return (
            posts.some(post => isOwn(post) && (post.kind === 'poll' || !isOther)) ||
            (!isOther && posts.every(({ kind }) => kind !== 'poll'))
        );
    });
});
