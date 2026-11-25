import { isNotEmptyArray } from '@rnw-community/shared';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { messageRef, pollForward, telegramPoll } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import type { Closes } from '../actions/action.model';

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

export const closureOf = Effect.fn('Core.closureOf')(function* (sessionId: string) {
    const poll = yield* openPollOf(sessionId);
    const chatIds = Option.isSome(poll) ? yield* pollChatsOf(sessionId) : [];

    return {
        pollIds: Option.toArray(poll).map(({ pollId }) => pollId),
        chatIds: chatIds.map(chatId => `${chatId}`).toSorted()
    } satisfies Closes;
});

export const titlesOfChats = Effect.fn('Core.titlesOfChats')(function* (chatIds: readonly string[]) {
    const db = yield* Db;
    const rows = isNotEmptyArray(chatIds)
        ? yield* db
              .select({ title: telegramChat.title })
              .from(telegramChat)
              .where(sql`${telegramChat.chatId}::text = any(${sql.param([...chatIds])}::text[])`)
        : [];

    return [...rows.map(({ title }) => `«${title}»`), ...(rows.length < chatIds.length ? ['❓'] : [])].join(', ');
});

// Whether the poll closes where it is, or a group that is switched off or gone keeps it open
export const closureOutlook = Effect.fn('Core.closureOutlook')(function* (closes: Closes | null | undefined) {
    const db = yield* Db;
    const chatIds = closes?.chatIds ?? [];
    const where = yield* titlesOfChats(chatIds);
    const open = yield* db
        .select({ chatId: telegramChat.chatId })
        .from(telegramChat)
        .where(and(eq(telegramChat.isPosting, true), inArray(telegramChat.chatId, chatIds.map(BigInt))));

    return { hasPoll: isNotEmptyArray([...(closes?.pollIds ?? [])]), isBlocked: open.length < chatIds.length, where };
});
