import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { messageRef, pollForward, telegramPoll } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import { and, eq, isNull } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';

import { ActionFailedError } from '../error/action-failed.error';
import { topicOptions } from '../utils/topic-options.util';

import { audienceOf } from './audience';

import type { GroupTarget } from '../interface/group-target.interface';

const uncertainForward = 'the forward result is uncertain, check the chat';

const claimForward = Effect.fn('Core.claimForward')(function* (pollId: string, chatId: bigint, resend: number | null) {
    const db = yield* Db;
    const claimedAt = yield* DateTime.nowAsDate;
    const claimed = yield* db
        .insert(pollForward)
        .values({ pollId, chatId, claimedAt })
        .onConflictDoNothing()
        .returning({ pollId: pollForward.pollId });

    if (isNotEmptyArray(claimed)) {
        return pollId;
    }

    const [existing] = yield* db
        .select({ messageId: pollForward.messageId })
        .from(pollForward)
        .where(and(eq(pollForward.pollId, pollId), eq(pollForward.chatId, chatId)));

    if (isDefined(existing?.messageId)) {
        return yield* ActionFailedError.make({ reason: 'the poll is already in this chat' });
    }

    const retaken = isDefined(resend)
        ? yield* db
              .update(pollForward)
              .set({ claimedAt, generation: resend + 1 })
              .where(
                  and(
                      eq(pollForward.pollId, pollId),
                      eq(pollForward.chatId, chatId),
                      isNull(pollForward.messageId),
                      eq(pollForward.generation, resend)
                  )
              )
              .returning({ pollId: pollForward.pollId })
        : [];

    if (!isNotEmptyArray(retaken)) {
        return yield* ActionFailedError.make({ reason: uncertainForward });
    }

    return pollId;
});

export const unknownForwardsOf = Effect.fn('Core.unknownForwardsOf')(function* (sessionId: string) {
    const db = yield* Db;
    const rows = yield* db
        .select({ chatId: pollForward.chatId, generation: pollForward.generation })
        .from(pollForward)
        .innerJoin(telegramPoll, eq(telegramPoll.pollId, pollForward.pollId))
        .where(and(eq(telegramPoll.sessionId, sessionId), isNull(telegramPoll.closedAt), isNull(pollForward.messageId)));

    return rows;
});

export const forwardPoll = Effect.fn('Core.forwardPoll')(function* (sessionId: string, target: GroupTarget, resend: number | null) {
    const db = yield* Db;
    const telegram = yield* Telegram;
    const [poll] = yield* db
        .select()
        .from(telegramPoll)
        .where(and(eq(telegramPoll.sessionId, sessionId), isNull(telegramPoll.closedAt)));

    if (!isDefined(poll)) {
        return yield* ActionFailedError.make({ reason: 'the game has no open poll' });
    }

    const audience = yield* audienceOf(sessionId);

    if (target.chatId < 0n && audience.some(chat => chat.chatId === target.chatId)) {
        return yield* ActionFailedError.make({ reason: 'the poll is already in this chat' });
    }

    const claim = and(eq(pollForward.pollId, poll.pollId), eq(pollForward.chatId, target.chatId));

    if (target.chatId < 0n) {
        yield* claimForward(poll.pollId, target.chatId, resend);
    }

    const sent = yield* telegram
        .call('forwardMessage', api => api.forwardMessage(Number(target.chatId), Number(poll.chatId), poll.messageId, topicOptions(target)))
        .pipe(
            Effect.catch(error =>
                Effect.gen(function* () {
                    if (error.isUncertain) {
                        return yield* ActionFailedError.make({ reason: uncertainForward });
                    }

                    yield* db.delete(pollForward).where(claim);

                    return yield* error;
                })
            )
        );
    yield* db.update(pollForward).set({ messageId: sent.message_id }).where(claim);
    yield* db
        .insert(messageRef)
        .values({ chatId: target.chatId, messageId: sent.message_id, purpose: 'poll', entityType: 'session', entityId: sessionId })
        .onConflictDoNothing();
    yield* telegram
        .call('pinChatMessage', api => api.pinChatMessage(Number(target.chatId), sent.message_id, { disable_notification: true }))
        .pipe(Effect.catch(error => Effect.logInfo('[poll] forward not pinned', error)));

    return { sessionId, messageId: sent.message_id };
});
