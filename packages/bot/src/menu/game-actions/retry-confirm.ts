import { linkedChatsOf } from '@rondo/core/community/community.repository';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { retryLabel } from '../games.screen';
import { menuText } from '../menu-text';
import { liveDraftElsewhere } from '../new-game/new-game.handler';
import { showScreen } from '../show-screen';

import { showConfirm } from './show-confirm';

import type { MenuUser } from '../screen.interface';
import type { Action } from '@rondo/core/actions/action.model';
import type { SessionView } from '@rondo/core/sessions/session.model';

export const confirmRetry = Effect.fn('Bot.confirmRetry')(function* (
    user: MenuUser,
    game: SessionView,
    parts: readonly string[],
    messageId: number
) {
    const [, op = '', , arg = '', topic = ''] = parts;
    const chosen: Action =
        op === 'pam'
            ? { _tag: 'announce_session', sessionId: game.id, chatId: String(user.tgUserId) }
            : {
                  _tag: 'announce_session',
                  sessionId: game.id,
                  ...(/^-\d+$/u.test(arg) ? { chatId: arg, topicId: /^\d+$/u.test(topic) ? Number(topic) : null } : {})
              };
    const live = parts.at(-1) === 'f' ? Option.none() : yield* liveDraftElsewhere(user, messageId);

    if (Option.isNone(live)) {
        return yield* showConfirm(user, chosen, { messageId, expected: null });
    }

    const chats = yield* linkedChatsOf(user.communityId);
    const title = op === 'pam' ? null : (chats.find(chat => String(chat.chatId) === arg)?.title ?? '');
    return yield* showScreen(user.chatId, messageId, {
        text: menuText(user.locale, 'ngLive'),
        keyboard: [
            [{ text: menuText(user.locale, 'ngContinue'), callback_data: 'm:ngc' }],
            [{ text: retryLabel(user, title), callback_data: `${parts.join(':')}:f` }]
        ]
    });
});
