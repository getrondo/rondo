import { isDefined } from '@rnw-community/shared';
import { messageRef, telegramPoll } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import { and, eq, isNull } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { ActionFailedError } from '../error/action-failed.error';
import { topicOptions } from '../utils/topic-options.util';

import { audienceOf } from './audience';

import type { GroupTarget } from '../interface/group-target.interface';

export const forwardPoll = Effect.fn('Core.forwardPoll')(function* (sessionId: string, target: GroupTarget) {
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

    if (audience.some(chat => chat.chatId === target.chatId)) {
        return yield* ActionFailedError.make({ reason: 'the poll is already in this chat' });
    }

    const sent = yield* telegram.call('forwardMessage', api =>
        api.forwardMessage(Number(target.chatId), Number(poll.chatId), poll.messageId, topicOptions(target))
    );
    yield* db
        .insert(messageRef)
        .values({ chatId: target.chatId, messageId: sent.message_id, purpose: 'poll', entityType: 'session', entityId: sessionId })
        .onConflictDoNothing();
    yield* telegram
        .call('pinChatMessage', api => api.pinChatMessage(Number(target.chatId), sent.message_id, { disable_notification: true }))
        .pipe(Effect.catch(error => Effect.logInfo('[poll] forward not pinned', error)));

    return { sessionId, messageId: sent.message_id };
});
