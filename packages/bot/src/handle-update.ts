import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { processedUpdate } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import * as Effect from 'effect/Effect';

import { handleCallbackQuery } from './handlers/callback-query.handler';
import { handleGroupMessage } from './handlers/group-message.handler';
import { handlePollAnswer } from './handlers/poll-answer.handler';
import { handlePrivateMessage } from './handlers/private-message.handler';

import type { Update } from 'grammy/types';

const claimUpdate = Effect.fn('Bot.claimUpdate')(function* (updateId: number) {
    const db = yield* Db;
    const rows = yield* db
        .insert(processedUpdate)
        .values({ updateId })
        .onConflictDoNothing()
        .returning({ updateId: processedUpdate.updateId });

    return isNotEmptyArray(rows);
});

const route = (update: Update) => {
    if (isDefined(update.message)) {
        const { message } = update;

        return message.chat.type === 'private' ? handlePrivateMessage(message) : handleGroupMessage(message);
    }

    if (isDefined(update.poll_answer)) {
        return handlePollAnswer(update.poll_answer);
    }

    if (isDefined(update.callback_query)) {
        return handleCallbackQuery(update.callback_query);
    }

    return Effect.void;
};

export const handleUpdate = Effect.fn('Bot.handleUpdate')(function* (update: Update) {
    if (!(yield* claimUpdate(update.update_id))) {
        return;
    }

    yield* route(update).pipe(
        Effect.tapCause(cause => Effect.logError(`[update ${update.update_id}] failed`, cause)),
        Effect.ignore
    );
});
