import { isDefined } from '@rnw-community/shared';
import { describeAction, displayOfVenue } from '@rondo/core/actions/describe-action';
import { groupLocaleOf } from '@rondo/core/community/community.repository';
import { cancelReasonText, formatSessionLabel } from '@rondo/core/i18n/messages';
import { placeSizes, rankVenues, timeChoices } from '@rondo/core/menu/game-suggestions';
import { sessionCancelledHtml, sessionChangedHtml } from '@rondo/core/notify/notifier';
import { requireSession } from '@rondo/core/sessions/session.service';
import { pollFor } from '@rondo/core/signups/poll-for';
import { lineupHtml } from '@rondo/core/teams/team.service';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';

import { toShortId } from '../../utils/to-short-id.util';
import { navRow } from '../games.screen';
import { menuText, type MenuKey } from '../menu-text';
import { pollHtml } from '../new-game/new-game.screen';

import { sessionOf } from './game-draft';

import type { NewGameData } from '../new-game/draft';
import type { MenuButton, MenuUser, Screen } from '../screen.interface';
import type { Action } from '@rondo/core/actions/action.model';
import type { SessionView } from '@rondo/core/sessions/session.model';

const reasons = ['weather', 'low_turnout', 'venue', 'holiday', 'organizer', 'other'] as const;

const chunk = (buttons: readonly MenuButton[], size: number): MenuButton[][] =>
    Array.from({ length: Math.ceil(buttons.length / size) }, (_, index) => buttons.slice(index * size, index * size + size));

const header = (user: MenuUser, game: SessionView, prompt: MenuKey) =>
    `⚽ <b>${escapeHtml(formatSessionLabel(user.locale, game))}</b>\n${menuText(user.locale, prompt)}`;

export const gameListScreen = (user: MenuUser, game: SessionView, data: NewGameData, op: string): Screen => {
    const id = toShortId(game.id);
    const button = (text: string, pick: string, arg: string): MenuButton => ({ text, callback_data: `c:${pick}:${id}:${arg}` });
    const nav = navRow(user.locale, `m:g:${id}`);

    switch (op) {
        case 't': {
            const times = timeChoices(data.history, game.venueId, game.localDate, game.localTime).filter(
                time => time !== game.localTime && (game.localDate !== data.today || time > data.nowTime)
            );

            return {
                text: header(user, game, 'pickTime'),
                keyboard: [
                    ...chunk(
                        times.map(time => button(time, 'ts', time.replace(':', ''))),
                        3
                    ),
                    nav
                ]
            };
        }
        case 'v': {
            const venues = rankVenues(data.history, data.venues, game.localDate)
                .filter(venue => venue.id !== game.venueId)
                .slice(0, 5);

            return {
                text: header(user, game, 'pickPlace'),
                keyboard: [...venues.map(venue => [button(venue.name, 'vs', toShortId(venue.id))]), nav]
            };
        }
        case 'z': {
            const current = game.capacityMax;
            const near = isDefined(current) ? [current - 2, current - 1, current + 1, current + 2] : [];
            const sizes = [...new Set([...placeSizes(data.history, game.venueId), ...near])]
                .filter(size => size >= 1 && size <= 99 && size !== current)
                .toSorted((left, right) => left - right);
            const limitless = isDefined(current) ? [[button(menuText(user.locale, 'noLimit'), 'zs', '0')]] : [];

            return {
                text: header(user, game, 'pickSize'),
                keyboard: [
                    ...chunk(
                        sizes.map(size => button(String(size), 'zs', String(size))),
                        3
                    ),
                    ...limitless,
                    nav
                ]
            };
        }
        case 'x': {
            return {
                text: header(user, game, 'cancelWhy'),
                keyboard: [
                    ...chunk(
                        reasons.map(reason => button(cancelReasonText(user.locale, reason), 'xr', reason)),
                        2
                    ),
                    nav
                ]
            };
        }
        default: {
            return {
                text: header(user, game, 'teams'),
                keyboard: [[2, 3].map(count => button(menuText(user.locale, 'teamCount', { count }), 'kn', String(count))), nav]
            };
        }
    }
};

const groupHtml = Effect.fn('Bot.groupHtml')(function* (user: MenuUser, game: SessionView, action: Action) {
    const locale = yield* groupLocaleOf(user.communityId);

    switch (action._tag) {
        case 'announce_session': {
            const poll = yield* pollFor(user.communityId, game, null);

            return pollHtml(poll);
        }
        case 'cancel_session': {
            return yield* sessionCancelledHtml({ target: game, reason: action.reason, locale });
        }
        case 'publish_teams': {
            return yield* lineupHtml(locale, game, action.teams);
        }
        case 'update_session': {
            const display = isDefined(action.venueId) ? yield* displayOfVenue(action.venueId) : {};
            const after = {
                ...game,
                ...display,
                localTime: action.localTime ?? game.localTime,
                capacityMax: action.capacityMax ?? game.capacityMax,
                venueId: action.venueId ?? game.venueId
            };

            return yield* sessionChangedHtml({ before: game, after, locale });
        }
        case 'create_person':
        case 'create_session':
        case 'create_venue':
        case 'grant_admin':
        case 'link_alias':
        case 'merge_people':
        case 'rename_person':
        case 'set_rating':
        case 'unlink_alias':
        case 'update_venue': {
            return '';
        }
        default: {
            return '';
        }
    }
});

const confirmButtons = (user: MenuUser, action: Action, revision: number, hasGroup: boolean): MenuButton[][] => {
    const ok = (key: MenuKey, notify: boolean): MenuButton => ({
        text: menuText(user.locale, key),
        callback_data: `c:ok:${revision}:${notify ? 1 : 0}`
    });

    if (action._tag === 'announce_session' || action._tag === 'publish_teams') {
        return [[ok('post', true)]];
    }

    const [loud, quiet]: [MenuKey, MenuKey] = action._tag === 'cancel_session' ? ['cancelYes', 'cancelNo'] : ['notifyYes', 'notifyNo'];

    return [hasGroup ? [ok(loud, true), ok(quiet, false)] : [ok(quiet, false)]];
};

export const confirmScreen = Effect.fn('Bot.confirmScreen')(function* (
    user: MenuUser,
    action: Action,
    context: { readonly revision: number; readonly hasGroup: boolean }
) {
    const sessionId = sessionOf(action);
    const game = yield* requireSession(user.communityId, sessionId);
    const summary = yield* describeAction(action, user.locale, user.communityId);
    const html = yield* groupHtml(user, game, action);
    const quoted = action._tag === 'announce_session' ? html : `<blockquote>${html}</blockquote>`;

    return {
        text: [escapeHtml(summary.split('\n\n')[0] ?? summary), '', menuText(user.locale, 'groupSees'), quoted].join('\n'),
        keyboard: [...confirmButtons(user, action, context.revision, context.hasGroup), navRow(user.locale, `m:g:${toShortId(sessionId)}`)]
    } satisfies Screen;
});
