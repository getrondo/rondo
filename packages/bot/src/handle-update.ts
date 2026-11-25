import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { addMillis } from '@rondo/core/utils/add-millis.util';
import { processedUpdate } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { TelegramUpdateSchema, type TelegramUpdate } from '@rondo/telegram/webhook/telegram-update.model';
import { and, eq, gt, isNull, lt, lte, sql } from 'drizzle-orm';
import * as Cause from 'effect/Cause';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Result from 'effect/Result';
import * as Schema from 'effect/Schema';

import { noFollowUp } from './context/follow-up';
import { UpdateFailedError } from './error/update-failed.error';
import { UpdateInProgressError } from './error/update-in-progress.error';
import { handleCallbackQuery } from './handlers/callback-query.handler';
import { handleChatMember } from './handlers/chat-member.handler';
import { handleGroupMessage } from './handlers/group-message.handler';
import { handlePollAnswer } from './handlers/poll-answer.handler';
import { handlePrivateMessage } from './handlers/private-message.handler';
import { causeCodes } from './utils/cause-codes.util';
import { updateShape } from './utils/update-shape.util';

const maxAttempts = 3;
// Longer than the route's maxDuration, so an unfinished attempt this old can no longer be running
const leaseMs = 65_000;

const claimUpdate = Effect.fn('Bot.claimUpdate')(function* (updateId: number) {
    const db = yield* Db;
    const at = yield* DateTime.nowAsDate;
    const rows = yield* db
        .insert(processedUpdate)
        .values({ updateId, at })
        .onConflictDoUpdate({
            target: processedUpdate.updateId,
            set: { attempts: sql`${processedUpdate.attempts} + 1`, at },
            setWhere: and(
                isNull(processedUpdate.doneAt),
                lt(processedUpdate.attempts, maxAttempts),
                lte(processedUpdate.at, addMillis(at, -leaseMs))
            )
        })
        .returning({ updateId: processedUpdate.updateId });

    if (isNotEmptyArray(rows)) {
        return true;
    }

    const [running] = yield* db
        .select({ updateId: processedUpdate.updateId })
        .from(processedUpdate)
        .where(
            and(
                eq(processedUpdate.updateId, updateId),
                isNull(processedUpdate.doneAt),
                lt(processedUpdate.attempts, maxAttempts),
                gt(processedUpdate.at, addMillis(at, -leaseMs))
            )
        );

    return isDefined(running) ? yield* UpdateInProgressError.make({ updateId }) : false;
});

const releaseUpdate = Effect.fn('Bot.releaseUpdate')(function* (updateId: number) {
    const db = yield* Db;
    const now = yield* DateTime.nowAsDate;
    yield* db
        .update(processedUpdate)
        .set({ at: addMillis(now, -leaseMs) })
        .where(eq(processedUpdate.updateId, updateId));
});

const route = Effect.fn('Bot.route')(function* (update: TelegramUpdate) {
    if ('message' in update) {
        return yield* update.message.chat.type === 'private' ? handlePrivateMessage(update.message) : handleGroupMessage(update.message);
    }

    if ('poll_answer' in update) {
        yield* handlePollAnswer(update.poll_answer);
    } else if ('chat_member' in update) {
        yield* handleChatMember(update.chat_member);
    } else {
        yield* handleCallbackQuery(update.callback_query);
    }

    return noFollowUp;
});

const decodeUpdate = Schema.decodeUnknownEffect(TelegramUpdateSchema);
const decodeUpdateId = Schema.decodeUnknownOption(Schema.Struct({ update_id: Schema.Int }));

export const handleUpdate = Effect.fn('Bot.handleUpdate')(function* (payload: unknown) {
    const decoded = yield* Effect.result(decodeUpdate(payload));

    if (Result.isFailure(decoded)) {
        const updateId = Option.map(decodeUpdateId(payload), ({ update_id: id }) => id);
        yield* Effect.logError(
            `[update ${Option.getOrElse(updateId, () => 'without id')}] ignored, its shape is not supported`,
            updateShape(payload, decoded.failure.issue)
        );

        return noFollowUp;
    }

    const update = decoded.success;

    if (!(yield* claimUpdate(update.update_id))) {
        return noFollowUp;
    }

    const isGroupMessage = 'message' in update && update.message.chat.type !== 'private';
    const followUp = yield* route(update).pipe(
        Effect.tapCause(cause => Effect.logError(`[update ${update.update_id}] failed`, isGroupMessage ? causeCodes(cause) : cause)),
        Effect.onError(() => releaseUpdate(update.update_id).pipe(Effect.ignore)),
        Effect.catchCause(cause =>
            Effect.gen(function* () {
                return isGroupMessage && !Cause.hasInterruptsOnly(cause)
                    ? yield* UpdateFailedError.make({ updateId: update.update_id })
                    : yield* Effect.failCause(cause);
            })
        )
    );
    const db = yield* Db;
    const doneAt = yield* DateTime.nowAsDate;
    yield* db.update(processedUpdate).set({ doneAt }).where(eq(processedUpdate.updateId, update.update_id));

    return followUp;
});
