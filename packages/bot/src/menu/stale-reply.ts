import { lastReceiptOf } from '@rondo/core/menu/game-history.repository';
import { addMillis } from '@rondo/core/utils/add-millis.util';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { gameCardScreen } from './games.screen';
import { menuText } from './menu-text';
import { showScreen } from './show-screen';

import type { MenuUser } from './screen.interface';

const receiptWindowMs = 10 * 60_000;

export const replyStale = Effect.fn('Bot.replyStale')(function* (user: MenuUser, messageId: number, withReceipt: boolean) {
    const receipt = withReceipt ? yield* lastReceiptOf(user.tgUserId, addMillis(user.now, -receiptWindowMs)) : Option.none<string>();
    const card = Option.isSome(receipt)
        ? yield* gameCardScreen(user, receipt.value, menuText(user.locale, 'alreadyDone')).pipe(Effect.option)
        : Option.none();

    if (Option.isSome(card)) {
        yield* showScreen(user.chatId, messageId, card.value);

        return Option.none<string>();
    }

    yield* showScreen(user.chatId, messageId, {
        text: menuText(user.locale, 'staleScreen'),
        keyboard: [[{ text: menuText(user.locale, 'newGame'), callback_data: 'm:ng' }]]
    });

    return Option.some(menuText(user.locale, 'stale'));
});
