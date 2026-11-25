import { isDefined } from '@rnw-community/shared';
import { groupLocaleOf } from '@rondo/core/community/community.repository';
import { cancelReasonText, formatSessionLabel } from '@rondo/core/i18n/messages';
import { dayChoices, placeSizes, rankVenues, timeChoices } from '@rondo/core/menu/game-suggestions';
import { sessionCancelledHtml, sessionChangedHtml } from '@rondo/core/notify/notifier';
import { requireSession } from '@rondo/core/sessions/session.service';
import { pollFor } from '@rondo/core/signups/poll-for';
import { lineupHtml } from '@rondo/core/teams/team.service';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';

import { buttonBudget } from '../../utils/button-budget.util';
import { dayLabel } from '../../utils/day-label.util';
import { fitLabel } from '../../utils/fit-label.util';
import { labelWidth } from '../../utils/label-width.util';
import { toShortId } from '../../utils/to-short-id.util';
import { navRow } from '../games.screen';
import { menuText, type MenuKey } from '../menu-text';
import { pollHtml } from '../new-game/new-game.screen';

import { afterChange, changeNotes } from './change-notes';
import { sessionOf } from './game-draft';
import { targetOfAction, type GameTarget } from './game-target';

import type { NewGameData } from '../new-game/draft';
import type { MenuButton, MenuUser, Screen } from '../screen.interface';
import type { Action } from '@rondo/core/actions/action.model';
import type { SessionView } from '@rondo/core/sessions/session.model';

const reasons = ['weather', 'low_turnout', 'venue', 'holiday', 'organizer', 'other'] as const;
const full = buttonBudget(1);

const chunk = (buttons: readonly MenuButton[], size: number): MenuButton[][] =>
    Array.from({ length: Math.ceil(buttons.length / size) }, (_, index) => buttons.slice(index * size, index * size + size));

const header = (user: MenuUser, game: SessionView, prompt: MenuKey) =>
    `⚽ <b>${escapeHtml(formatSessionLabel(user.locale, game))}</b>\n${menuText(user.locale, prompt)}`;

const listRows = (
    user: MenuUser,
    game: SessionView,
    data: NewGameData,
    pick: { readonly op: string; readonly button: (text: string, choice: string, arg: string) => MenuButton }
) => {
    const { op, button } = pick;

    switch (op) {
        case 't': {
            const times = timeChoices(data.history, game.venueId, game.localDate, game.localTime).filter(
                time => time !== game.localTime && (game.localDate !== data.today || time > data.nowTime)
            );

            return chunk(
                times.map(time => button(time, 'ts', time.replace(':', ''))),
                3
            );
        }
        case 'dd': {
            const days = dayChoices(data.history, data.today, { today: false })
                .toSorted()
                .filter(day => day !== game.localDate);

            return chunk(
                days.map(day => button(dayLabel(user.locale, day), 'ds', day.replaceAll('-', ''))),
                2
            );
        }
        case 'v': {
            const venues = rankVenues(data.history, data.venues, game.localDate)
                .filter(venue => venue.id !== game.venueId)
                .slice(0, 5);

            return venues.map(venue => [button(fitLabel(venue.name, full), 'vs', toShortId(venue.id))]);
        }
        case 'z': {
            const current = game.capacityMax;
            const near = isDefined(current) ? [current - 2, current - 1, current + 1, current + 2] : [];
            const sizes = [...new Set([...placeSizes(data.history, game.venueId), ...near])]
                .filter(size => size >= 1 && size <= 99 && size !== current)
                .toSorted((left, right) => left - right);

            return [
                ...chunk(
                    sizes.map(size => button(String(size), 'zs', String(size))),
                    3
                ),
                ...(isDefined(current) ? [[button(menuText(user.locale, 'noLimit'), 'zs', '0')]] : [])
            ];
        }
        case 'x': {
            return reasons.map(reason => [button(cancelReasonText(user.locale, reason), 'xr', reason)]);
        }
        default: {
            return [[2, 3].map(count => button(menuText(user.locale, 'teamCount', { count }), 'kn', String(count)))];
        }
    }
};

const prompts: Readonly<Record<string, MenuKey>> = { t: 'pickTime', dd: 'pickDay', v: 'pickPlace', z: 'pickSize', x: 'cancelWhy' };

export const gameListScreen = (user: MenuUser, game: SessionView, data: NewGameData, op: string): Screen => {
    const id = toShortId(game.id);
    const button = (text: string, pick: string, arg: string): MenuButton => ({ text, callback_data: `c:${pick}:${id}:${arg}` });

    return {
        text: header(user, game, prompts[op] ?? 'teams'),
        keyboard: [...listRows(user, game, data, { op, button }), navRow(user.locale, `m:g:${id}`)]
    };
};

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
    const pick = (toKey: MenuKey, meKey: MenuKey, quietKey: MenuKey) => {
        if (!loud) {
            return menuText(user.locale, quietKey);
        }

        if (target.me) {
            return menuText(user.locale, meKey);
        }

        const room = full - labelWidth(menuText(user.locale, toKey, { where: '' }));

        return menuText(user.locale, toKey, { where: fitLabel(where, room) });
    };

    if (action._tag === 'update_session') {
        return pick('notifyTo', 'notifyMe', 'notifyNo');
    }

    if (action._tag === 'cancel_session') {
        return pick('cancelTo', 'cancelMe', 'cancelNo');
    }

    return action._tag === 'delete_session' ? menuText(user.locale, 'deleteYes') : pick('sendTo', 'sendMeShort', 'notifyNo');
};

export const confirmScreen = Effect.fn('Bot.confirmScreen')(function* (user: MenuUser, action: Action, revision: number) {
    const sessionId = sessionOf(action);
    const game = yield* requireSession(user.communityId, sessionId);
    const target = yield* targetOfAction(user, action, sessionId);
    const ok = (loud: boolean): MenuButton => ({
        text: okLabel(user, action, target, loud),
        callback_data: `c:ok:${revision}:${loud ? 1 : 0}`
    });
    const nav = navRow(user.locale, `m:g:${toShortId(sessionId)}`);

    if (action._tag === 'delete_session') {
        return { text: menuText(user.locale, 'deleteAsk'), keyboard: [[ok(false)], nav] } satisfies Screen;
    }

    const sees = target.me ? menuText(user.locale, 'meSees') : menuText(user.locale, 'groupSees', { where: escapeHtml(target.where) });
    const notes = action._tag === 'update_session' ? yield* changeNotes(user, game, action) : [];
    const closing = action._tag === 'cancel_session' ? [menuText(user.locale, 'pollCloses')] : [];
    const quiet = action._tag === 'update_session' || action._tag === 'cancel_session';

    return {
        text: [sees, yield* groupHtml(user, game, action), ...notes, ...closing].join('\n'),
        keyboard: [[ok(true)], ...(quiet ? [[ok(false)]] : []), nav]
    } satisfies Screen;
});
