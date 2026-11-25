import { text } from '@rondo/core/i18n/messages';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import * as Effect from 'effect/Effect';

import type { Locale } from '@rondo/core/i18n/locale';
import type { Api } from 'grammy';

type SendOptions = NonNullable<Parameters<Api['sendMessage']>[2]>;
type EditOptions = NonNullable<Parameters<Api['editMessageText']>[3]>;

// Screens and answers go to one person only. A group is written to through writeToChat, with an approval
const onlyPrivate = (chatId: number) => (chatId > 0 ? Effect.void : Effect.die(new Error('not a private chat')));

export const sendPrivate = Effect.fn('Bot.sendPrivate')(function* (chatId: number, body: string, options: SendOptions = {}) {
    const telegram = yield* Telegram;
    yield* onlyPrivate(chatId);

    return yield* telegram.call('sendMessage', api => api.sendMessage(chatId, body, options));
});

export const editPrivate = Effect.fn('Bot.editPrivate')(function* (
    chatId: number,
    messageId: number,
    body: string,
    options: EditOptions = {}
) {
    const telegram = yield* Telegram;
    yield* onlyPrivate(chatId);

    return yield* telegram.call('editMessageText', api => api.editMessageText(chatId, messageId, body, options));
});

export const clearPrivateKeyboard = Effect.fn('Bot.clearPrivateKeyboard')(function* (chatId: number, messageId: number) {
    const telegram = yield* Telegram;
    yield* onlyPrivate(chatId);

    return yield* telegram.call('editMessageReplyMarkup', api =>
        api.editMessageReplyMarkup(chatId, messageId, { reply_markup: { inline_keyboard: [] } })
    );
});

const telegramMessageLimit = 4000;

const confirmationKeyboard = (locale: Locale, actionId: string) => ({
    inline_keyboard: [
        [
            { text: text(locale, 'confirm'), callback_data: `act:${actionId}:y` },
            { text: text(locale, 'reject'), callback_data: `act:${actionId}:n` }
        ]
    ]
});

export const sendProposal = Effect.fn('Bot.sendProposal')(function* (
    chatId: number,
    locale: Locale,
    proposal: { readonly actionId: string; readonly summary: string }
) {
    yield* sendPrivate(chatId, `${proposal.summary}\n\n${text(locale, 'confirmQuestion')}`.slice(0, telegramMessageLimit), {
        reply_markup: confirmationKeyboard(locale, proposal.actionId)
    });
});
