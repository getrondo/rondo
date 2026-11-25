import { isDefined } from '@rnw-community/shared';
import { decideAction, type DecisionOutcome } from '@rondo/core/actions/pending-action.service';
import { resolveLocale, type Locale } from '@rondo/core/i18n/locale';
import { text } from '@rondo/core/i18n/messages';
import { clearAdminState } from '@rondo/core/menu/admin-state.repository';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { actionContextFor } from '../context/action-context';
import { handleMenuTap } from '../menu/menu-callback.handler';
import { menuText } from '../menu/menu-text';
import { menuUserOf } from '../menu/menu-user';
import { showScreen } from '../menu/show-screen';

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

const menuData = /^[cmn]:/u;

const handleMenuCallback = Effect.fn('Bot.handleMenuCallback')(function* (query: CallbackQuery, chatId: number, messageId: number) {
    const telegram = yield* Telegram;
    const user = yield* menuUserOf(query.from);
    const answer = (toast: string | undefined) =>
        telegram
            .call('answerCallbackQuery', api => api.answerCallbackQuery(query.id, isDefined(toast) ? { text: toast } : {}))
            .pipe(Effect.ignore);

    if (Option.isNone(user)) {
        const revoked = menuText(resolveLocale(query.from.language_code), 'revoked');
        yield* clearAdminState(BigInt(query.from.id));
        yield* answer(revoked);
        yield* showScreen(chatId, messageId, { text: revoked, keyboard: [] });

        return;
    }

    const toast = yield* handleMenuTap(user.value, query.data ?? '', messageId);
    yield* answer(Option.getOrUndefined(toast));
});

export const handleCallbackQuery = Effect.fn('Bot.handleCallbackQuery')(function* (query: CallbackQuery) {
    const telegram = yield* Telegram;
    const match = actionData.exec(query.data ?? '');
    const answer = telegram.call('answerCallbackQuery', api => api.answerCallbackQuery(query.id)).pipe(Effect.ignore);

    if (menuData.test(query.data ?? '') && query.message?.chat.type === 'private') {
        yield* handleMenuCallback(query, query.message.chat.id, query.message.message_id);

        return;
    }

    if (!isDefined(match) || query.message?.chat.type !== 'private') {
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

    // A second tap leaves the message to the first one
    if (isDefined(message) && outcome._tag !== 'missing') {
        yield* telegram
            .call('editMessageText', api => api.editMessageText(message.chat.id, message.message_id, outcomeText(locale, outcome)))
            .pipe(Effect.ignore);
    }
});
