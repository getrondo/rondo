import * as Effect from 'effect/Effect';

import { toShortId } from '../../utils/to-short-id.util';
import { menuText, type MenuKey } from '../menu-text';
import { showScreen } from '../show-screen';

import type { MenuUser } from '../screen.interface';

export const showSelfReceipt = Effect.fn('Bot.showSelfReceipt')(function* (
    user: MenuUser,
    messageId: number,
    receipt: { readonly sessionId: string; readonly status: MenuKey }
) {
    yield* showScreen(user.chatId, messageId, { text: menuText(user.locale, 'belowLine'), keyboard: [] });
    yield* showScreen(user.chatId, null, {
        text: [menuText(user.locale, receipt.status), menuText(user.locale, 'selfHint')].join('\n'),
        keyboard: [
            [
                { text: menuText(user.locale, 'games'), callback_data: 'm:gl' },
                { text: menuText(user.locale, 'edit'), callback_data: `m:g:${toShortId(receipt.sessionId)}` }
            ]
        ]
    });
});
