import { messageRef, pollForward, telegramPoll } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, isNull } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

// Groups the poll of a game is in: the original, recorded copies and forwards that may have arrived
export const pollChatsOf = Effect.fn('Core.pollChatsOf')(function* (sessionId: string) {
    const db = yield* Db;
    const copies = yield* db
        .select({ chatId: messageRef.chatId })
        .from(messageRef)
        .where(and(eq(messageRef.entityId, sessionId), eq(messageRef.purpose, 'poll')));
    const polls = yield* db
        .select({ chatId: telegramPoll.chatId, forwardedTo: pollForward.chatId })
        .from(telegramPoll)
        .leftJoin(pollForward, eq(pollForward.pollId, telegramPoll.pollId))
        .where(eq(telegramPoll.sessionId, sessionId));
    const chatIds = [...copies.map(({ chatId }) => chatId), ...polls.flatMap(({ chatId, forwardedTo }) => [chatId, forwardedTo ?? chatId])];

    return [...new Set(chatIds)].filter(chatId => chatId < 0n);
});

export const openPollOf = Effect.fn('Core.openPollOf')(function* (sessionId: string) {
    const db = yield* Db;
    const [poll] = yield* db
        .select()
        .from(telegramPoll)
        .where(and(eq(telegramPoll.sessionId, sessionId), isNull(telegramPoll.closedAt)));

    return Option.fromNullishOr(poll);
});
