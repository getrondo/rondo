import { isDefined } from '@rnw-community/shared';
import { decideAction, type DecisionOutcome } from '@rondo/core/actions/pending-action.service';
import { resolveLocale, type Locale } from '@rondo/core/i18n/locale';
import { text } from '@rondo/core/i18n/messages';
import { rememberLanguage } from '@rondo/core/identity/telegram-user';
import { clearAdminState } from '@rondo/core/menu/admin-state.repository';
import { plainText } from '@rondo/core/utils/plain-text.util';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { actionContextFor } from '../context/action-context';
import { editPrivate } from '../context/private-chat';
import { failureText } from '../menu/failure-text';
import { gameCardScreen } from '../menu/games.screen';
import { askApprover, noteOutcome, staysOpen } from '../menu/groups/approval';
import { handleMenuTap } from '../menu/menu-callback.handler';
import { menuText } from '../menu/menu-text';
import { menuUserOf } from '../menu/menu-user';
import { openNewGameFrom } from '../menu/new-game/new-game.handler';
import { showScreen } from '../menu/show-screen';

import type { Action } from '@rondo/core/actions/action.model';
import type { CallbackQuery, User } from '@rondo/telegram/webhook/telegram-update.model';

const actionData = /^act:([\da-f-]{36}):([eny])$/u;

const outcomeText = (locale: Locale, outcome: DecisionOutcome): string => {
    switch (outcome._tag) {
        case 'done': {
            return `${outcome.summary}\n\n${text(locale, 'done')}${staysOpen(locale, outcome.openIn)}`;
        }
        case 'failed': {
            return `${outcome.summary}\n\n${failureText(locale, outcome.failure).text}`;
        }
        case 'rejected': {
            return text(locale, 'rejected');
        }
        case 'awaiting':
        case 'missing':
        case 'expired': {
            return text(locale, 'expired');
        }
        default: {
            return text(locale, 'expired');
        }
    }
};

const menuData = /^[cgmnt]:/u;

const handleMenuCallback = Effect.fn('Bot.handleMenuCallback')(function* (query: CallbackQuery, chatId: number, messageId: number) {
    const telegram = yield* Telegram;
    const user = yield* menuUserOf(query.from);
    yield* rememberLanguage(BigInt(query.from.id), query.from.language_code);
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

    const toast = yield* handleMenuTap(user.value, query.data ?? '', messageId).pipe(
        Effect.catchTag('ActionFailedError', error =>
            Effect.gen(function* () {
                const { text: reason } = failureText(user.value.locale, error.failure);
                yield* showScreen(chatId, messageId, {
                    text: reason,
                    keyboard: [
                        [
                            { text: menuText(user.value.locale, 'games'), callback_data: 'm:gl' },
                            { text: menuText(user.value.locale, 'home_'), callback_data: 'm:h' }
                        ]
                    ]
                });

                return Option.fromNullishOr(reason);
            })
        )
    );
    yield* answer(Option.getOrUndefined(toast));
});

const openForChange = Effect.fn('Bot.openForChange')(function* (from: User, action: Action | null) {
    const user = yield* menuUserOf(from);

    if (Option.isNone(user) || !isDefined(action)) {
        return;
    }

    if (action._tag === 'create_session') {
        yield* openNewGameFrom(user.value, action);
    } else if ('sessionId' in action && isDefined(action.sessionId)) {
        const card = yield* gameCardScreen(user.value, action.sessionId, null);
        yield* showScreen(user.value.chatId, null, card);
    }
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
    const isEdited = match[2] === 'e';
    const outcome = yield* decideAction({
        actionId: match[1] ?? '',
        tgUserId,
        confirm: match[2] === 'y',
        context: actionContextFor
    });
    const { message } = query;
    const asked = outcome._tag === 'awaiting' ? yield* askApprover(outcome.request, locale) : '';
    const shown = outcome._tag === 'awaiting' ? `${outcome.request.summary}\n\n${plainText(asked)}` : outcomeText(locale, outcome);
    yield* noteOutcome(outcome, { decidedBy: tgUserId, isEdited });

    // A second tap leaves the message to the first one
    if (isDefined(message) && outcome._tag !== 'missing') {
        yield* editPrivate(message.chat.id, message.message_id, shown).pipe(Effect.ignore);
    }

    if (isEdited && outcome._tag === 'rejected') {
        yield* openForChange(query.from, outcome.action);
    }
});
