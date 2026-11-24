import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { addMillis } from '@rondo/core/utils/add-millis.util';
import { processedUpdate } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, gt, isNull, lt, lte, sql } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';

import { UpdateInProgressError } from './error/update-in-progress.error';
import { handleCallbackQuery } from './handlers/callback-query.handler';
import { handleGroupMessage } from './handlers/group-message.handler';
import { handlePollAnswer } from './handlers/poll-answer.handler';
import { handlePrivateMessage } from './handlers/private-message.handler';

import type { Update } from 'grammy/types';

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

const route = Effect.fn('Bot.route')(function* (update: Update) {
    if (isDefined(update.message)) {
        const { message } = update;
        yield* message.chat.type === 'private' ? handlePrivateMessage(message) : handleGroupMessage(message);
    } else if (isDefined(update.poll_answer)) {
        yield* handlePollAnswer(update.poll_answer);
    } else if (isDefined(update.callback_query)) {
        yield* handleCallbackQuery(update.callback_query);
    }
});

export const handleUpdate = Effect.fn('Bot.handleUpdate')(function* (update: Update) {
    if (!(yield* claimUpdate(update.update_id))) {
        return;
    }

    yield* route(update).pipe(
        Effect.tapCause(cause => Effect.logError(`[update ${update.update_id}] failed`, cause)),
        Effect.onError(() => releaseUpdate(update.update_id).pipe(Effect.ignore))
    );
    const db = yield* Db;
    const doneAt = yield* DateTime.nowAsDate;
    yield* db.update(processedUpdate).set({ doneAt }).where(eq(processedUpdate.updateId, update.update_id));
});
