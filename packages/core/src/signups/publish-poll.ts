// This poll and the stopPoll of deleteSession run inside a transaction: each ends within 10 seconds and waits at most 3 for a rate limit
import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { messageRef, telegramPoll } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { maxWaitInTransaction } from '@rondo/telegram/service/telegram.service';
import { and, eq, isNull } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Option from 'effect/Option';
import * as Ref from 'effect/Ref';

import { ActionFailedError } from '../error/action-failed.error';
import { requireSession } from '../sessions/session.service';
import { writeToChat, type Approval } from '../telegram/write-to-chat';

import { pollFor, previewOf } from './poll-for';
import { lockSession } from './signup.service';

import type { GroupTarget } from '../interface/group-target.interface';

interface PublishPollInput<PrepareFailure, PrepareRequirements, SettleFailure, SettleRequirements> {
    readonly communityId: string;
    readonly group: GroupTarget;
    readonly approval: Approval;
    readonly note: string | null | undefined;
    readonly approvedSummary: string | null;
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
    const { group: target, approval } = input;
    const { chatId } = target;
    const sentMessage = yield* Ref.make<number | null>(null);
    const isWritten = yield* Ref.make(false);

    const publish = Effect.gen(function* () {
        const sessionId = yield* input.prepare;

        const open = yield* lockSession(sessionId);

        if (Option.isNone(open)) {
            return yield* ActionFailedError.make({ failure: { code: 'game_over' } });
        }

        const openPolls = yield* db
            .select({ pollId: telegramPoll.pollId })
            .from(telegramPoll)
            .where(and(eq(telegramPoll.sessionId, sessionId), isNull(telegramPoll.closedAt)));

        if (isNotEmptyArray(openPolls)) {
            return yield* ActionFailedError.make({ failure: { code: 'poll_open' } });
        }

        const game = yield* requireSession(input.communityId, sessionId);

        if (game.startsAt.getTime() <= (yield* DateTime.nowAsDate).getTime()) {
            return yield* ActionFailedError.make({ failure: { code: 'time_passed' } });
        }

        const poll = yield* pollFor(input.communityId, game, input.note);

        if (isDefined(input.approvedSummary) && input.approvedSummary.split('\n\n').slice(1).join('\n\n') !== previewOf(poll)) {
            return yield* ActionFailedError.make({ failure: { code: 'preview_changed' } });
        }

        const { messageId, pollId } = yield* writeToChat({
            target,
            approval,
            content: { _tag: 'poll', poll },
            options: maxWaitInTransaction
        });
        yield* Ref.set(sentMessage, messageId);
        yield* db.insert(telegramPoll).values({ pollId, chatId, messageId, sessionId, options: ['in', 'out'] });
        yield* db
            .insert(messageRef)
            .values({ chatId, messageId, purpose: 'poll', entityType: 'session', entityId: sessionId })
            .onConflictDoNothing();
        yield* input.settle({ sessionId, messageId });
        yield* Ref.set(isWritten, true);

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
                    const uncertain = ActionFailedError.make({ failure: { code: 'result_uncertain' } });
                    const saved = yield* db
                        .select({ sessionId: telegramPoll.sessionId })
                        .from(telegramPoll)
                        .where(and(eq(telegramPoll.chatId, chatId), eq(telegramPoll.messageId, sent)))
                        .pipe(Effect.mapError(() => uncertain));

                    if (isNotEmptyArray(saved)) {
                        return { sessionId: saved[0].sessionId, messageId: sent };
                    }

                    // Only the commit can have failed, and it may still go through
                    if (yield* Ref.get(isWritten)) {
                        return yield* uncertain;
                    }

                    const stopped = yield* Effect.exit(writeToChat({ target, approval, content: { _tag: 'stop_poll', messageId: sent } }));

                    return yield* ActionFailedError.make({
                        failure: { code: Exit.isSuccess(stopped) ? 'poll_unsaved_closed' : 'poll_unsaved_open' }
                    });
                })
            )
        );

    if (chatId < 0n) {
        yield* writeToChat({ target, approval, content: { _tag: 'pin', messageId: result.messageId } }).pipe(
            Effect.catch(error => Effect.logInfo('[poll] not pinned', error))
        );
    }

    return result;
});
