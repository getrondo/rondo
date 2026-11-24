import { text } from '@rondo/core/i18n/messages';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import * as Effect from 'effect/Effect';

import type { Locale } from '@rondo/core/i18n/locale';

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
    const telegram = yield* Telegram;

    yield* telegram.call('sendMessage', api =>
        api.sendMessage(chatId, `${proposal.summary}\n\n${text(locale, 'confirmQuestion')}`.slice(0, telegramMessageLimit), {
            reply_markup: confirmationKeyboard(locale, proposal.actionId)
        })
    );
});
