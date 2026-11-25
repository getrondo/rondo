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
        .select({ chatId: messageRef.chatId, isPosting: telegramChat.isPosting, topicId: telegramChat.topicId })
        .from(messageRef)
        .innerJoin(session, eq(session.id, messageRef.entityId))
        .leftJoin(telegramChat, and(eq(telegramChat.chatId, messageRef.chatId), eq(telegramChat.communityId, session.communityId)))
        .where(and(eq(messageRef.entityId, sessionId), eq(messageRef.purpose, 'poll')))
        .orderBy(asc(messageRef.createdAt), asc(messageRef.messageId));
});

type PollRef = Effect.Success<ReturnType<typeof pollRefsOf>>[number];

const unique = (targets: readonly GroupTarget[]) => [
    ...new Map(targets.map(({ chatId, topicId }): [bigint, GroupTarget] => [chatId, { chatId, topicId }])).values()
];

// Only groups still linked to the game's community and switched on, or a private chat the poll was sent to
const writable = (rows: readonly PollRef[]) => unique(rows.filter(row => row.chatId > 0n || row.isPosting === true));

export const audienceOf = (sessionId: string) => pollRefsOf(sessionId).pipe(Effect.map(rows => writable(rows)));

// A game that was never posted falls back, a posted game whose chats are all gone stays silent,
// and the admin gets what a switched off group would have got
export const noticeTargets = Effect.fn('Core.noticeTargets')(function* (
    sessionId: string,
    fallback: readonly GroupTarget[],
    admin: readonly GroupTarget[]
) {
    const rows = yield* pollRefsOf(sessionId);

    if (!isNotEmptyArray(rows)) {
        return fallback;
    }

    return rows.some(row => row.isPosting === false) ? unique([...writable(rows), ...admin]) : writable(rows);
});
