import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { communityProfile, linkedChatsOf } from '@rondo/core/community/community.repository';
import { knownChatsOf } from '@rondo/core/community/group-settings';
import { formatSessionLabel } from '@rondo/core/i18n/messages';
import { listSessions } from '@rondo/core/sessions/session.service';
import { rosterOf } from '@rondo/core/signups/signup.service';
import { addDays } from '@rondo/core/utils/add-days.util';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { buttonBudget } from '../utils/button-budget.util';
import { fitLabel } from '../utils/fit-label.util';
import { toShortId } from '../utils/to-short-id.util';

import { menuText } from './menu-text';

import type { MenuUser, Screen } from './screen.interface';
import type { SessionView } from '@rondo/core/sessions/session.model';

const openStatuses = new Set(['open', 'full', 'locked', 'draft']);

export const upcomingGames = Effect.fn('Bot.upcomingGames')(function* (user: MenuUser) {
    const games = yield* listSessions(user.communityId, { from: user.today, to: addDays(user.today, 60) });

    return games.filter(game => openStatuses.has(game.status));
});

export const signedUpLine = Effect.fn('Bot.signedUpLine')(function* (user: MenuUser, game: SessionView) {
    const roster = yield* rosterOf(game.id);
    const count = roster.filter(entry => entry.status === 'in' && entry.role === 'field').length;

    return isDefined(game.capacityMax)
        ? menuText(user.locale, 'signedUpOf', { count, max: game.capacityMax })
        : menuText(user.locale, 'signedUp', { count });
});

const nextGameLine = Effect.fn('Bot.nextGameLine')(function* (user: MenuUser, next: SessionView | undefined) {
    return isDefined(next)
        ? `${menuText(user.locale, 'nextGame')}: <b>${escapeHtml(formatSessionLabel(user.locale, next))}</b>, ${yield* signedUpLine(user, next)}`
        : menuText(user.locale, 'noGames');
});

export const startScreen = Effect.fn('Bot.startScreen')(function* (user: MenuUser, firstName: string) {
    const upcoming = yield* upcomingGames(user);
    const played = yield* listSessions(user.communityId, { from: addDays(user.today, -180), to: user.today });
    const games =
        isNotEmptyArray(upcoming) || isNotEmptyArray(played) ? [{ text: menuText(user.locale, 'games'), callback_data: 'm:gl' }] : [];

    return {
        text: menuText(user.locale, 'startHello', { name: escapeHtml(firstName) }),
        keyboard: [[{ text: menuText(user.locale, 'newGame'), callback_data: 'm:ng' }, ...games]]
    } satisfies Screen;
});

export const homeScreen = Effect.fn('Bot.homeScreen')(function* (user: MenuUser) {
    const profile = yield* communityProfile(user.communityId);
    const [next] = yield* upcomingGames(user);
    const name = Option.match(profile, { onNone: () => '', onSome: value => value.name });
    const nextLine = yield* nextGameLine(user, next);
    const groups = [...(yield* linkedChatsOf(user.communityId)), ...(yield* knownChatsOf(user.communityId))];

    return {
        text: [menuText(user.locale, 'home', { name: escapeHtml(name) }), '', nextLine].join('\n'),
        keyboard: [
            [
                { text: menuText(user.locale, 'newGame'), callback_data: 'm:ng' },
                { text: menuText(user.locale, 'games'), callback_data: 'm:gl' }
            ],
            ...(isDefined(next)
                ? [
                      [
                          {
                              text: fitLabel(`⚽ ${formatSessionLabel(user.locale, next)}`, buttonBudget(1)),
                              callback_data: `m:g:${toShortId(next.id)}`
                          }
                      ]
                  ]
                : []),
            ...(isNotEmptyArray(groups) ? [[{ text: menuText(user.locale, 'groupsButton'), callback_data: 'g:a' }]] : [])
        ]
    } satisfies Screen;
});
