import { isNotEmptyArray } from '@rnw-community/shared';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import type { GroupTarget } from '../interface/group-target.interface';

const pollRefsOf = Effect.fn('Core.pollRefsOf')(function* (sessionId: string) {
    const db = yield* Db;

    return yield* db
        .select({ chatId: messageRef.chatId, linked: telegramChat.chatId, topicId: telegramChat.topicId })
        .from(messageRef)
        .innerJoin(session, eq(session.id, messageRef.entityId))
        .leftJoin(telegramChat, and(eq(telegramChat.chatId, messageRef.chatId), eq(telegramChat.communityId, session.communityId)))
        .where(and(eq(messageRef.entityId, sessionId), eq(messageRef.purpose, 'poll')))
        .orderBy(asc(messageRef.createdAt), asc(messageRef.messageId));
});

// Only chats still linked to the game's community, or a private chat the poll was sent to
export const audienceOf = Effect.fn('Core.audienceOf')(function* (sessionId: string) {
    const rows = yield* pollRefsOf(sessionId);
    const current = rows.filter(row => row.chatId > 0n || row.linked === row.chatId);

    return [
        ...new Map(current.map((row): [bigint, GroupTarget] => [row.chatId, { chatId: row.chatId, topicId: row.topicId ?? null }])).values()
    ];
});

// A game that was never posted falls back, a posted game whose chats are all gone stays silent
export const noticeTargets = Effect.fn('Core.noticeTargets')(function* (sessionId: string, fallback: readonly GroupTarget[]) {
    const rows = yield* pollRefsOf(sessionId);

    return isNotEmptyArray(rows) ? yield* audienceOf(sessionId) : fallback;
});
