import { isDefined, isEmptyArray } from '@rnw-community/shared';
import { extraction, messageRef, sourceRef } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, inArray } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import type { GroupMessage } from './live-ingest';

type PostingChat = Pick<GroupMessage, 'chatId' | 'isMain'>;

// Games posted in this chat. A post without a chat id and a game without any post belong to the main chat
export const gamesOfChat = Effect.fn('Core.gamesOfChat')(function* <Game extends { readonly id: string }>(
    games: readonly Game[],
    { chatId, isMain }: PostingChat
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
    const isOwn = (post: { readonly chatId: bigint | number | null }): boolean =>
        isDefined(post.chatId) ? BigInt(post.chatId) === chatId : isMain;

    return games.filter(({ id }) => {
        const posts = [...live, ...imported].filter(({ sessionId }) => sessionId === id);
        const isPolled = posts.some(({ kind }) => kind === 'poll');

        return posts.some(post => isOwn(post) && (post.kind === 'poll' || isMain || !isPolled)) || (isMain && isEmptyArray(posts));
    });
});
