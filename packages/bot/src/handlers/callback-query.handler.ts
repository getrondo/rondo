import { isDefined } from '@rnw-community/shared';
import { decideAction, type DecisionOutcome } from '@rondo/core/actions/pending-action.service';
import { resolveLocale, type Locale } from '@rondo/core/i18n/locale';
import { text } from '@rondo/core/i18n/messages';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import * as Effect from 'effect/Effect';

import { actionContextFor } from '../context/action-context';

import type { CallbackQuery } from 'grammy/types';

const actionData = /^act:([\da-f-]{36}):([yn])$/u;

const outcomeText = (locale: Locale, outcome: DecisionOutcome): string => {
    switch (outcome._tag) {
        case 'done': {
            return `${outcome.summary}\n\n${text(locale, 'done')}`;
        }
        case 'failed': {
            return `${outcome.summary}\n\n${text(locale, 'failed')}: ${outcome.reason}`;
        }
        case 'rejected': {
            return text(locale, 'rejected');
        }
        case 'missing':
        case 'expired': {
            return text(locale, 'expired');
        }
        default: {
            return text(locale, 'expired');
        }
    }
};

export const handleCallbackQuery = Effect.fn('Bot.handleCallbackQuery')(function* (query: CallbackQuery) {
    const telegram = yield* Telegram;
    const match = actionData.exec(query.data ?? '');
    const answer = telegram.call('answerCallbackQuery', api => api.answerCallbackQuery(query.id)).pipe(Effect.ignore);

    if (!isDefined(match)) {
        yield* answer;

        return;
    }

    const tgUserId = BigInt(query.from.id);
    const locale = resolveLocale(query.from.language_code);
    yield* answer;
    const outcome = yield* decideAction({
        actionId: match[1] ?? '',
        tgUserId,
        confirm: match[2] === 'y',
        context: actionContextFor(tgUserId)
    });
    const { message } = query;

    if (isDefined(message)) {
        yield* telegram
            .call('editMessageText', api => api.editMessageText(message.chat.id, message.message_id, outcomeText(locale, outcome)))
            .pipe(Effect.ignore);
    }
});
