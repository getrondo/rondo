import { groupLocaleOf } from '@rondo/core/community/community.repository';
import { formatSessionLabel } from '@rondo/core/i18n/messages';
import { sessionCancelledHtml, sessionChangedHtml } from '@rondo/core/notify/notifier';
import { requireSession } from '@rondo/core/sessions/session.service';
import { pollFor } from '@rondo/core/signups/poll-for';
import { lineupHtml } from '@rondo/core/teams/team.service';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';

import { buttonBudget } from '../../utils/button-budget.util';
import { fitLabel } from '../../utils/fit-label.util';
import { labelWidth } from '../../utils/label-width.util';
import { toShortId } from '../../utils/to-short-id.util';
import { menuText, type MenuKey } from '../menu-text';
import { pollHtml } from '../new-game/new-game.screen';

import { afterChange, changeNotes } from './change-notes';
import { sessionOf } from './game-draft';
import { targetOfAction, type GameTarget } from './game-target';

import type { MenuButton, MenuUser, Screen } from '../screen.interface';
import type { Action } from '@rondo/core/actions/action.model';
import type { SessionView } from '@rondo/core/sessions/session.model';

const full = buttonBudget(1);

const groupHtml = Effect.fn('Bot.groupHtml')(function* (user: MenuUser, game: SessionView, action: Action) {
    const locale = yield* groupLocaleOf(user.communityId);

    if (action._tag === 'announce_session' || action._tag === 'forward_poll') {
        const poll = yield* pollFor(user.communityId, game, null);

        return pollHtml(poll);
    }

    if (action._tag === 'cancel_session') {
        return `<blockquote>${yield* sessionCancelledHtml({ target: game, reason: action.reason, locale })}</blockquote>`;
    }

    if (action._tag === 'publish_teams') {
        return `<blockquote>${yield* lineupHtml(locale, game, action.teams)}</blockquote>`;
    }

    if (action._tag === 'update_session') {
        const after = yield* afterChange(game, action);

        return `<blockquote>${yield* sessionChangedHtml({ before: game, after, locale })}</blockquote>`;
    }

    return '';
});

const okLabel = (user: MenuUser, action: Action, target: GameTarget, loud: boolean): string => {
    const { where } = target;
    const pick = (toKey: MenuKey, meKey: MenuKey, [quietKey, quietMeKey]: readonly [MenuKey, MenuKey]) => {
        if (!loud) {
            return menuText(user.locale, target.me ? quietMeKey : quietKey);
        }

        if (target.me) {
            return menuText(user.locale, meKey);
        }

        const room = full - labelWidth(menuText(user.locale, toKey, { where: '' }));

        return menuText(user.locale, toKey, { where: fitLabel(where, room) });
    };

    if (action._tag === 'update_session') {
        return pick('notifyTo', 'notifyMe', ['notifyNo', 'notifyNoMe']);
    }

    if (action._tag === 'cancel_session') {
        return pick('cancelTo', 'cancelMe', ['cancelNo', 'cancelNoMe']);
    }

    if (action._tag === 'delete_session') {
        return menuText(user.locale, 'deleteYes');
    }

    return pick('sendTo', action._tag === 'publish_teams' ? 'sendMeShort' : 'sendMe', ['notifyNo', 'notifyNoMe']);
};

export const confirmScreen = Effect.fn('Bot.confirmScreen')(function* (user: MenuUser, action: Action, revision: number) {
    const sessionId = sessionOf(action);
    const game = yield* requireSession(user.communityId, sessionId);
    const target = yield* targetOfAction(user, action, sessionId);
    const ok = (loud: boolean): MenuButton => ({
        text: okLabel(user, action, target, loud),
        callback_data: `c:ok:${revision}:${loud ? 1 : 0}`
    });
    const nav = [{ text: menuText(user.locale, 'back'), callback_data: `m:g:${toShortId(sessionId)}` }];

    if (action._tag === 'delete_session') {
        const label = escapeHtml(formatSessionLabel(user.locale, game));

        return { text: menuText(user.locale, 'deleteAsk', { label }), keyboard: [[ok(false)], nav] } satisfies Screen;
    }

    const sees = target.me ? menuText(user.locale, 'meSees') : menuText(user.locale, 'groupSees', { where: escapeHtml(target.where) });
    const notes = action._tag === 'update_session' ? yield* changeNotes(user, game, { action, loud: !target.me }) : [];
    const closing = action._tag === 'cancel_session' ? [menuText(user.locale, 'pollCloses')] : [];
    const quiet = action._tag === 'update_session' || action._tag === 'cancel_session';

    return {
        text: [sees, yield* groupHtml(user, game, action), ...notes, ...closing].join('\n'),
        keyboard: [[ok(true)], ...(quiet ? [[ok(false)]] : []), nav]
    } satisfies Screen;
});
