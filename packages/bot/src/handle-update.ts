import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { processedUpdate } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';

import { handleCallbackQuery } from './handlers/callback-query.handler';
import { handleGroupMessage } from './handlers/group-message.handler';
import { handlePollAnswer } from './handlers/poll-answer.handler';
import { handlePrivateMessage } from './handlers/private-message.handler';

import type { Update } from 'grammy/types';

const maxAttempts = 3;

const claimUpdate = Effect.fn('Bot.claimUpdate')(function* (updateId: number) {
    const db = yield* Db;
    const rows = yield* db
        .insert(processedUpdate)
        .values({ updateId })
        .onConflictDoUpdate({
            target: processedUpdate.updateId,
            set: { attempts: sql`${processedUpdate.attempts} + 1` },
            setWhere: and(isNull(processedUpdate.doneAt), lt(processedUpdate.attempts, maxAttempts))
        })
        .returning({ updateId: processedUpdate.updateId });

    return isNotEmptyArray(rows);
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

    yield* route(update).pipe(Effect.tapCause(cause => Effect.logError(`[update ${update.update_id}] failed`, cause)));
    const db = yield* Db;
    const doneAt = yield* DateTime.nowAsDate;
    yield* db.update(processedUpdate).set({ doneAt }).where(eq(processedUpdate.updateId, update.update_id));
});
