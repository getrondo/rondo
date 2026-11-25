import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { mainGroupOf } from '@rondo/core/community/community.repository';
import { countOf, formatSessionLabel } from '@rondo/core/i18n/messages';
import { hasPollFor } from '@rondo/core/menu/game-history.repository';
import { listSessions, requireSession } from '@rondo/core/sessions/session.service';
import { rosterOf } from '@rondo/core/signups/signup.service';
import { addDays } from '@rondo/core/utils/add-days.util';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { toShortId } from '../utils/to-short-id.util';

import { signedUpLine, upcomingGames } from './home.screen';
import { menuText } from './menu-text';

import type { MenuButton, MenuUser, Screen } from './screen.interface';
import type { Locale } from '@rondo/core/i18n/locale';
import type { SessionView } from '@rondo/core/sessions/session.model';

const pastShown = 5;

const statusText: Readonly<Record<Locale, Readonly<Record<string, string>>>> = {
    uk: {
        open: 'запис відкрито',
        full: 'місць немає',
        locked: 'склад закрито',
        played: 'зіграно',
        cancelled: 'скасовано',
        moved: 'перенесено',
        draft: 'чернетка'
    },
    ru: {
        open: 'запись открыта',
        full: 'мест нет',
        locked: 'состав закрыт',
        played: 'сыграно',
        cancelled: 'отменено',
        moved: 'перенесено',
        draft: 'черновик'
    }
};

export const navRow = (locale: Locale, back: string): MenuButton[] => [
    { text: menuText(locale, 'back'), callback_data: back },
    { text: menuText(locale, 'home_'), callback_data: 'm:h' }
];

const gameButton = (locale: Locale, game: SessionView): MenuButton[] => [
    {
        text: `${game.status === 'cancelled' ? '✖️ ' : ''}${formatSessionLabel(locale, game)}`,
        callback_data: `m:g:${toShortId(game.id)}`
    }
];

export const gamesScreen = Effect.fn('Bot.gamesScreen')(function* (user: MenuUser) {
    const upcoming = yield* upcomingGames(user);
    const past = (yield* listSessions(user.communityId, { from: addDays(user.today, -180), to: addDays(user.today, -1) }))
        .slice(-pastShown)
        .toSorted((left, right) => right.localDate.localeCompare(left.localDate));
    const sections = [
        ...(isNotEmptyArray(upcoming)
            ? [`<b>${menuText(user.locale, 'upcoming')}</b>`, ...upcoming.map(game => escapeHtml(formatSessionLabel(user.locale, game)))]
            : []),
        ...(isNotEmptyArray(past)
            ? [`<b>${menuText(user.locale, 'past')}</b>`, ...past.map(game => escapeHtml(formatSessionLabel(user.locale, game)))]
            : [])
    ];

    return {
        text: [
            menuText(user.locale, 'gamesTitle'),
            '',
            ...(isNotEmptyArray(sections) ? sections : [menuText(user.locale, 'noneYet')])
        ].join('\n'),
        keyboard: [
            ...[...upcoming, ...past].map(game => gameButton(user.locale, game)),
            [{ text: menuText(user.locale, 'newGame'), callback_data: 'm:ng' }],
            navRow(user.locale, 'm:h')
        ]
    } satisfies Screen;
});

const names = (entries: readonly { readonly displayName: string }[]) =>
    isNotEmptyArray(entries) ? entries.map(entry => escapeHtml(entry.displayName)).join(', ') : '—';

const actionRows = (user: MenuUser, game: SessionView, canPost: boolean, signed: number): MenuButton[][] => {
    const id = toShortId(game.id);
    const button = (key: Parameters<typeof menuText>[1], op: string): MenuButton => ({
        text: menuText(user.locale, key),
        callback_data: `c:${op}:${id}`
    });
    const first = [...(canPost ? [button('postPoll', 'p')] : []), ...(signed >= 2 ? [button('teams', 'k')] : [])];

    return [
        ...(isNotEmptyArray(first) ? [first] : []),
        [button('time', 't'), button('place', 'v'), button('size', 'z')],
        [button('cancelGame', 'x')]
    ];
};

export const gameCardScreen = Effect.fn('Bot.gameCardScreen')(function* (user: MenuUser, sessionId: string, header: string | null) {
    const game = yield* requireSession(user.communityId, sessionId);
    const roster = yield* rosterOf(sessionId);
    const signed = roster.filter(entry => entry.status === 'in' && entry.role === 'field');
    const hasPoll = yield* hasPollFor(sessionId);
    const isUpcoming = game.localDate >= user.today && ['open', 'full', 'locked', 'draft'].includes(game.status);
    const group = yield* mainGroupOf(user.communityId);
    const size = [
        ...(isDefined(game.fieldsPlanned) ? [countOf(user.locale, 'field', game.fieldsPlanned)] : []),
        ...(isDefined(game.capacityMax) ? [countOf(user.locale, 'place', game.capacityMax)] : []),
        statusText[user.locale][game.status] ?? game.status
    ];
    const lines = [
        ...(isDefined(header) ? [header, ''] : []),
        `⚽ <b>${escapeHtml(formatSessionLabel(user.locale, game))}</b>`,
        size.join(' · '),
        menuText(user.locale, hasPoll ? 'pollPosted' : 'pollMissing'),
        `${menuText(user.locale, 'signed')}: ${yield* signedUpLine(user, game)}`,
        names(signed),
        `${menuText(user.locale, 'waiting')}: ${names(roster.filter(entry => entry.status === 'waitlisted'))}`,
        `${menuText(user.locale, 'keepers')}: ${names(roster.filter(entry => entry.status === 'in' && entry.role === 'gk'))}`
    ];

    return {
        text: lines.join('\n'),
        keyboard: [
            ...(isUpcoming ? actionRows(user, game, !hasPoll && Option.isSome(group), signed.length) : []),
            navRow(user.locale, 'm:gl')
        ]
    } satisfies Screen;
});
