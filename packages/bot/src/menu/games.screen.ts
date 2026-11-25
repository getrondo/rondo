import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { linkedChatsOf } from '@rondo/core/community/community.repository';
import { formatSessionLabel } from '@rondo/core/i18n/messages';
import { hasOpenPoll, hasPollFor } from '@rondo/core/menu/game-history.repository';
import { isDeletableSession } from '@rondo/core/sessions/delete-session';
import { listSessions, requireSession } from '@rondo/core/sessions/session.service';
import { audienceOf } from '@rondo/core/signups/audience';
import { rosterOf } from '@rondo/core/signups/signup.service';
import { addDays } from '@rondo/core/utils/add-days.util';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';

import { buttonBudget } from '../utils/button-budget.util';
import { fitLabel } from '../utils/fit-label.util';
import { toShortId } from '../utils/to-short-id.util';

import { signedUpLine, upcomingGames } from './home.screen';
import { menuText } from './menu-text';

import type { MenuButton, MenuUser, Screen } from './screen.interface';
import type { Locale } from '@rondo/core/i18n/locale';
import type { SessionView } from '@rondo/core/sessions/session.model';

const pastShown = 5;

const closedText: Readonly<Record<Locale, Readonly<Record<string, string>>>> = {
    uk: { played: 'Зіграно', cancelled: 'Скасовано', moved: 'Перенесено' },
    ru: { played: 'Сыграно', cancelled: 'Отменено', moved: 'Перенесено' }
};

export const navRow = (locale: Locale, back: string): MenuButton[] => [
    { text: menuText(locale, 'back'), callback_data: back },
    { text: menuText(locale, 'home_'), callback_data: 'm:h' }
];

const gameButton = (locale: Locale, game: SessionView): MenuButton[] => [
    {
        text: fitLabel(`${game.status === 'cancelled' ? '✖️ ' : ''}${formatSessionLabel(locale, game)}`, buttonBudget(1)),
        callback_data: `m:g:${toShortId(game.id)}`
    }
];

export const gamesScreen = Effect.fn('Bot.gamesScreen')(function* (user: MenuUser) {
    const upcoming = yield* upcomingGames(user);
    const recent = yield* listSessions(user.communityId, { from: addDays(user.today, -180), to: addDays(user.today, -1) });
    const past = recent
        .filter(game => isDefined(game.venueName))
        .slice(-pastShown)
        .toSorted((left, right) => right.localDate.localeCompare(left.localDate));
    const games = [...upcoming, ...past];

    return {
        text: isNotEmptyArray(games)
            ? menuText(user.locale, 'gamesTitle')
            : `${menuText(user.locale, 'gamesTitle')}\n${menuText(user.locale, 'noneYet')}`,
        keyboard: [
            ...games.map(game => gameButton(user.locale, game)),
            [{ text: menuText(user.locale, 'newGame'), callback_data: 'm:ng' }],
            navRow(user.locale, 'm:h')
        ]
    } satisfies Screen;
});

const capitalized = (value: string): string => `${value.charAt(0).toUpperCase()}${value.slice(1)}`;

const names = (entries: readonly { readonly displayName: string }[]) => entries.map(entry => escapeHtml(entry.displayName)).join(', ');

const actionRows = (
    user: MenuUser,
    game: SessionView,
    state: {
        readonly canPost: boolean;
        readonly canDelete: boolean;
        readonly signed: number;
        readonly closedTo: readonly { readonly chatId: bigint; readonly title: string }[];
    }
): MenuButton[][] => {
    const id = toShortId(game.id);
    const button = (key: Parameters<typeof menuText>[1], op: string): MenuButton => ({
        text: menuText(user.locale, key),
        callback_data: `c:${op}:${id}`
    });
    const first = [...(state.canPost ? [button('postPoll', 'p')] : []), ...(state.signed >= 2 ? [button('teams', 'k')] : [])];
    const openRows = state.closedTo.map(chat => [
        {
            text: fitLabel(menuText(user.locale, 'openFor', { title: chat.title }), buttonBudget(1)),
            callback_data: `c:f:${id}:${chat.chatId}`
        }
    ]);

    return [
        ...(isNotEmptyArray(first) ? [first] : []),
        ...openRows,
        [button('time', 't'), button('place', 'v'), button('size', 'z')],
        [button('cancelGame', 'x'), ...(state.canDelete ? [button('deleteGame', 'd')] : [])]
    ];
};

export const gameCardScreen = Effect.fn('Bot.gameCardScreen')(function* (user: MenuUser, sessionId: string, header: string | null) {
    const game = yield* requireSession(user.communityId, sessionId);
    const roster = yield* rosterOf(sessionId);
    const signed = roster.filter(entry => entry.status === 'in' && entry.role === 'field');
    const hasPoll = yield* hasPollFor(sessionId);
    const isUpcoming = game.localDate >= user.today && ['open', 'full', 'locked', 'draft'].includes(game.status);
    const chats = yield* linkedChatsOf(user.communityId);
    const audience = yield* audienceOf(sessionId);
    const isOpen = yield* hasOpenPoll(sessionId);
    const canDelete = yield* isDeletableSession(user.communityId, sessionId, user.today);
    const closedTo = isOpen ? chats.filter(chat => !audience.some(target => target.chatId === chat.chatId)) : [];
    const free = isDefined(game.capacityMax)
        ? [menuText(user.locale, 'free', { free: Math.max(0, game.capacityMax - signed.length) })]
        : [];
    const waiting = roster.filter(entry => entry.status === 'waitlisted');
    const keepers = roster.filter(entry => entry.status === 'in' && entry.role === 'gk');
    const closed = closedText[user.locale][game.status];
    const signedLine = yield* signedUpLine(user, game);
    const lines = [
        ...(isDefined(header) ? [header, ''] : []),
        `⚽ <b>${escapeHtml(formatSessionLabel(user.locale, game))}</b>`,
        ...(isDefined(closed) ? [closed] : []),
        [capitalized(signedLine), ...free].join(' · '),
        ...(isNotEmptyArray(waiting) ? [`${menuText(user.locale, 'waiting')}: ${names(waiting)}`] : []),
        ...(isNotEmptyArray(keepers) ? [`${menuText(user.locale, 'keepers')}: ${names(keepers)}`] : [])
    ];

    return {
        text: lines.join('\n'),
        keyboard: [
            ...(isUpcoming
                ? actionRows(user, game, { canPost: !hasPoll && isNotEmptyArray(chats), canDelete, signed: signed.length, closedTo })
                : []),
            navRow(user.locale, 'm:gl')
        ]
    } satisfies Screen;
});
