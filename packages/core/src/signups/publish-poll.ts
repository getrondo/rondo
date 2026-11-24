// The poll is sent inside the transaction. No other network call is, and the Telegram client limits this one to 10 seconds
import { isDefined } from '@rnw-community/shared';
import { messageRef, telegramPoll } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Option from 'effect/Option';
import * as Ref from 'effect/Ref';

import { ActionFailedError } from '../error/action-failed.error';
import { requireSession } from '../sessions/session.service';
import { topicOptions } from '../utils/topic-options.util';

import { pollFor } from './poll-for';
import { lockSession } from './signup.service';

import type { GroupTarget } from '../interface/group-target.interface';

interface PublishPollInput<PrepareFailure, PrepareRequirements, SettleFailure, SettleRequirements> {
    readonly communityId: string;
    readonly group: GroupTarget;
    readonly note: string | null | undefined;
    readonly prepare: Effect.Effect<string, PrepareFailure, PrepareRequirements>;
    readonly settle: (result: {
        readonly sessionId: string;
        readonly messageId: number;
    }) => Effect.Effect<void, SettleFailure, SettleRequirements>;
}

export const publishPoll = Effect.fn('Core.publishPoll')(function* <PrepareFailure, PrepareRequirements, SettleFailure, SettleRequirements>(
    input: PublishPollInput<PrepareFailure, PrepareRequirements, SettleFailure, SettleRequirements>
) {
    const db = yield* Db;
    const telegram = yield* Telegram;
    const { chatId } = input.group;
    const sentMessage = yield* Ref.make<number | null>(null);

    const publish = Effect.gen(function* () {
        const sessionId = yield* input.prepare;

        const open = yield* lockSession(sessionId);

        if (Option.isNone(open)) {
            return yield* ActionFailedError.make({ reason: 'the game is already over or cancelled' });
        }

        const target = yield* requireSession(input.communityId, sessionId);
        const poll = yield* pollFor(input.communityId, target, input.note);
        const options = poll.answers.map(answer => ({ text: answer }));
        const sent = yield* telegram.call('sendPoll', api =>
            api.sendPoll(Number(chatId), poll.question, options, {
                is_anonymous: false,
                allows_multiple_answers: false,
                ...topicOptions(input.group)
            })
        );
        const messageId = sent.message_id;
        yield* Ref.set(sentMessage, messageId);
        yield* db.insert(telegramPoll).values({ pollId: sent.poll.id, chatId, messageId, sessionId, options: ['in', 'out'] });
        yield* db
            .insert(messageRef)
            .values({ chatId, messageId, purpose: 'poll', entityType: 'session', entityId: sessionId })
            .onConflictDoNothing();
        yield* input.settle({ sessionId, messageId });

        return { sessionId, messageId };
    });

    const result = yield* db
        .transaction(() => publish)
        .pipe(
            Effect.catchCause(cause =>
                Effect.gen(function* () {
                    const sent = yield* Ref.get(sentMessage);

                    if (!isDefined(sent)) {
                        return yield* Effect.failCause(cause);
                    }

                    yield* Effect.logError('[poll] sent but not saved', cause);
                    const stopped = yield* Effect.exit(telegram.call('stopPoll', api => api.stopPoll(Number(chatId), sent)));
                    const state = Exit.isSuccess(stopped) ? 'so it was closed' : 'and it could not be closed: check the group';

                    return yield* ActionFailedError.make({ reason: `the poll was sent but could not be saved, ${state}` });
                })
            )
        );

    yield* telegram
        .call('pinChatMessage', api => api.pinChatMessage(Number(chatId), result.messageId, { disable_notification: true }))
        .pipe(Effect.catch(error => Effect.logInfo('[poll] not pinned', error)));

    return result;
});
