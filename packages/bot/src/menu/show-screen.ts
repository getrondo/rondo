import { isDefined } from '@rnw-community/shared';
import * as Effect from 'effect/Effect';

import { clearPrivateKeyboard, editPrivate, sendPrivate } from '../context/private-chat';

import type { Screen } from './screen.interface';

const telegramMessageLimit = 4000;
const notModified = /message is not modified/iu;

export const showScreen = Effect.fn('Bot.showScreen')(function* (chatId: number, messageId: number | null, screen: Screen) {
    const text = screen.text.slice(0, telegramMessageLimit);
    const options = {
        parse_mode: 'HTML' as const,
        reply_markup: { inline_keyboard: screen.keyboard },
        link_preview_options: { is_disabled: true }
    };

    if (isDefined(messageId)) {
        const isShown = yield* editPrivate(chatId, messageId, text, options).pipe(
            Effect.as(true),
            Effect.catch(error => Effect.succeed(notModified.test(error.description)))
        );

        if (isShown) {
            return messageId;
        }
    }

    const sent = yield* sendPrivate(chatId, text, options);

    return sent.message_id;
});

export const clearKeyboard = (chatId: number, messageId: number) => clearPrivateKeyboard(chatId, messageId).pipe(Effect.ignore);
