import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { linkedChatsOf } from '@rondo/core/community/community.repository';
import { countOf, formatSessionLabel } from '@rondo/core/i18n/messages';
import { hasOpenPoll } from '@rondo/core/menu/game-history.repository';
import { hasOnlyAdminVotes, isDeletableSession } from '@rondo/core/sessions/delete-session';
import { listSessions, requireSession } from '@rondo/core/sessions/session.service';
import { audienceOf } from '@rondo/core/signups/audience';
import { unknownForwardsOf } from '@rondo/core/signups/forward-poll';
import { rosterOf } from '@rondo/core/signups/signup.service';
import { addDays } from '@rondo/core/utils/add-days.util';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';

import { buttonBudget } from '../utils/button-budget.util';
import { fitLabel } from '../utils/fit-label.util';
import { labelWidth } from '../utils/label-width.util';
import { toShortId } from '../utils/to-short-id.util';

import { signedUpLine, upcomingGames } from './home.screen';
import { menuText, type MenuKey } from './menu-text';
import { quotedTitles } from './new-game/audience';

import type { MenuButton, MenuUser, Screen } from './screen.interface';
import type { Locale } from '@rondo/core/i18n/locale';
import type { SessionView } from '@rondo/core/sessions/session.model';

const pastShown = 5;
const namesPerPage = 8;
const full = buttonBudget(1);

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
        text: fitLabel(`${game.status === 'cancelled' ? '✖️ ' : ''}${formatSessionLabel(locale, game)}`, full),
        callback_data: `m:g:${toShortId(game.id)}`
    }
];

const pastGames = Effect.fn('Bot.pastGames')(function* (user: MenuUser) {
    const recent = yield* listSessions(user.communityId, { from: addDays(user.today, -180), to: addDays(user.today, -1) });

    return recent
        .filter(game => isDefined(game.venueName))
        .slice(-pastShown)
        .toSorted((left, right) => right.localDate.localeCompare(left.localDate));
});

export const gamesScreen = Effect.fn('Bot.gamesScreen')(function* (user: MenuUser) {
    const upcoming = yield* upcomingGames(user);
    const past = yield* pastGames(user);
    const empty = !isNotEmptyArray(upcoming) && !isNotEmptyArray(past);

    return {
        text: empty ? `${menuText(user.locale, 'gamesTitle')}\n${menuText(user.locale, 'noneYet')}` : menuText(user.locale, 'gamesTitle'),
        keyboard: [
            ...upcoming.map(game => gameButton(user.locale, game)),
            ...(isNotEmptyArray(past) ? [[{ text: menuText(user.locale, 'pastGames'), callback_data: 'm:gp' }]] : []),
            [{ text: menuText(user.locale, 'newGame'), callback_data: 'm:ng' }],
            [{ text: menuText(user.locale, 'home_'), callback_data: 'm:h' }]
        ]
    } satisfies Screen;
});

export const pastGamesScreen = Effect.fn('Bot.pastGamesScreen')(function* (user: MenuUser) {
    const past = yield* pastGames(user);

    return {
        text: menuText(user.locale, 'pastGames'),
        keyboard: [...past.map(game => gameButton(user.locale, game)), [{ text: menuText(user.locale, 'back'), callback_data: 'm:gl' }]]
    } satisfies Screen;
});

const capitalized = (value: string): string => `${value.charAt(0).toUpperCase()}${value.slice(1)}`;

const names = (entries: readonly { readonly displayName: string }[]) => entries.map(entry => escapeHtml(entry.displayName)).join(', ');

interface CardState {
    readonly hasPoll: boolean;
    readonly canDelete: boolean;
    readonly privateOnly: boolean;
    readonly signed: number;
    readonly chats: readonly { readonly chatId: bigint; readonly title: string }[];
    readonly closedTo: readonly { readonly chatId: bigint; readonly title: string }[];
    readonly unknownTo: readonly { readonly chatId: bigint; readonly title: string; readonly token: string }[];
    readonly retry: RetryTarget | null;
    readonly page: number;
}

const retryRoom = (user: MenuUser): number => full - labelWidth(menuText(user.locale, 'resendTo', { where: '«»' }));

export const retryLabel = (user: MenuUser, title: string | null): string =>
    isDefined(title)
        ? menuText(user.locale, 'retryCard', { where: `«${fitLabel(title, retryRoom(user))}»` })
        : menuText(user.locale, 'retryCardMe');

const actionRows = (user: MenuUser, game: SessionView, state: CardState): MenuButton[][] => {
    const id = toShortId(game.id);
    const button = (key: MenuKey, op: string): MenuButton => ({ text: menuText(user.locale, key), callback_data: `c:${op}:${id}` });
    const [firstChat] = state.chats;
    const retryChat = isDefined(state.retry) && state.retry !== 'me' ? state.retry : null;
    const retryTitle = state.chats.find(chat => String(chat.chatId) === retryChat?.chatId)?.title ?? '';
    const retryRows = isDefined(retryChat)
        ? [
              [
                  {
                      text: retryLabel(user, retryTitle),
                      callback_data: `c:pa:${id}:${retryChat.chatId}:${retryChat.topicId ?? ''}`
                  }
              ]
          ]
        : [[button('retryCardMe', 'pam')]];
    const offerRows = [
        ...(isDefined(firstChat)
            ? [
                  [
                      {
                          text: fitLabel(menuText(user.locale, 'postCard', { where: `«${firstChat.title}»` }), full),
                          callback_data: `c:p:${id}`
                      }
                  ]
              ]
            : []),
        [button('sendPollMe', 'pm')]
    ];
    const unposted = isDefined(state.retry) ? retryRows : offerRows;
    const postRows = state.hasPoll ? [] : unposted;
    const resend = state.privateOnly ? [[button('resendMe', 'pr')]] : [];
    const unknownRows = state.unknownTo.map(chat => [
        {
            text: menuText(user.locale, 'resendTo', {
                where: `«${fitLabel(chat.title, retryRoom(user))}»`
            }),
            callback_data: `c:fr:${id}:${toShortId(chat.token)}`
        }
    ]);
    const openRows = state.closedTo.map(chat => [
        { text: fitLabel(menuText(user.locale, 'openFor', { title: chat.title }), full), callback_data: `c:f:${id}:${chat.chatId}` }
    ]);
    const pages = Math.ceil(state.signed / namesPerPage);
    const paging = [
        ...(state.page > 0 ? [{ text: '◀️', callback_data: `m:g:${id}:${state.page - 1}` }] : []),
        ...(state.page + 1 < pages ? [{ text: '▶️', callback_data: `m:g:${id}:${state.page + 1}` }] : [])
    ];

    return [
        ...postRows,
        ...resend,
        ...unknownRows,
        ...openRows,
        [button('time', 't'), button('day', 'dd')],
        [button('place', 'v'), button('size', 'z')],
        ...(state.signed >= 2 ? [[button('teams', 'k')]] : []),
        [button('cancelGame', 'x')],
        ...(state.canDelete ? [[button('deleteGame', 'd')]] : []),
        ...(isNotEmptyArray(paging) ? [paging] : [])
    ];
};

const pollLine = (user: MenuUser, state: CardState, audience: readonly bigint[]): string[] => {
    const groups = state.chats.filter(chat => audience.includes(chat.chatId)).map(chat => chat.title);

    if (isNotEmptyArray(groups)) {
        return [menuText(user.locale, 'pollIn', { where: escapeHtml(quotedTitles(groups, user.locale)) })];
    }

    if (state.privateOnly) {
        return [menuText(user.locale, 'pollMine')];
    }

    return state.hasPoll ? [] : [menuText(user.locale, 'pollNone')];
};

export type RetryTarget = 'me' | { readonly chatId: string; readonly topicId: number | null };

export interface CardHeader {
    readonly text: string;
    readonly saysPoll: boolean;
    readonly retry?: RetryTarget;
}

const countLine = (user: MenuUser, game: SessionView, signedLine: string, signed: number): string => {
    if (signed === 0) {
        const places = isDefined(game.capacityMax) ? [countOf(user.locale, 'place', game.capacityMax)] : [];

        return [menuText(user.locale, 'nobodyYet'), ...places].join(' · ');
    }

    const free =
        isDefined(game.capacityMax) && !['cancelled', 'played', 'moved'].includes(game.status)
            ? [menuText(user.locale, 'free', { free: Math.max(0, game.capacityMax - signed) })]
            : [];

    return [capitalized(signedLine), ...free].join(' · ');
};

export const gameCardPage = Effect.fn('Bot.gameCardPage')(function* (
    user: MenuUser,
    sessionId: string,
    header: CardHeader | null,
    page: number
) {
    const game = yield* requireSession(user.communityId, sessionId);
    const roster = yield* rosterOf(sessionId);
    const signed = roster.filter(entry => entry.status === 'in' && entry.role === 'field');
    const isUpcoming = game.localDate >= user.today && ['open', 'full', 'locked', 'draft'].includes(game.status);
    const chats = yield* linkedChatsOf(user.communityId);
    const audience = (yield* audienceOf(sessionId)).map(target => target.chatId);
    const isOpen = yield* hasOpenPoll(sessionId);
    const onlyAdmins = yield* hasOnlyAdminVotes(user.communityId, sessionId);
    const canDelete = yield* isDeletableSession(user.communityId, sessionId, user.today);
    const unknown = yield* unknownForwardsOf(sessionId);
    const state: CardState = {
        hasPoll: isNotEmptyArray(audience),
        canDelete,
        privateOnly: isOpen && onlyAdmins && isNotEmptyArray(audience) && audience.every(chatId => chatId > 0n),
        signed: signed.length,
        chats,
        closedTo: isOpen
            ? chats.filter(chat => !audience.includes(chat.chatId) && !unknown.some(claim => claim.chatId === chat.chatId))
            : [],
        unknownTo: isOpen
            ? chats.flatMap(chat =>
                  unknown
                      .filter(claim => claim.chatId === chat.chatId && !audience.includes(chat.chatId))
                      .map(claim => ({ chatId: chat.chatId, title: chat.title, token: claim.token }))
              )
            : [],
        retry: header?.retry ?? null,
        page
    };
    const waiting = roster.filter(entry => entry.status === 'waitlisted');
    const keepers = roster.filter(entry => entry.status === 'in' && entry.role === 'gk');
    const closed = closedText[user.locale][game.status];
    const signedLine = yield* signedUpLine(user, game);
    const shown = signed.slice(page * namesPerPage, page * namesPerPage + namesPerPage);
    const lines = [
        ...(isDefined(header) ? [header.text, ''] : []),
        ...(isUpcoming
            ? state.unknownTo
                  .map(chat => menuText(user.locale, 'uncertainForward', { where: escapeHtml(`«${chat.title}»`) }))
                  .filter(line => header?.text.includes(line) !== true)
            : []),
        `⚽ <b>${escapeHtml(formatSessionLabel(user.locale, game))}</b>`,
        ...(isDefined(closed) ? [closed] : []),
        ...(isUpcoming && header?.saysPoll !== true ? pollLine(user, state, audience) : []),
        countLine(user, game, signedLine, signed.length),
        ...shown.map((entry, index) => `${page * namesPerPage + index + 1}. ${escapeHtml(entry.displayName)}`),
        ...(isNotEmptyArray(waiting) ? [`${menuText(user.locale, 'waiting')}: ${names(waiting)}`] : []),
        ...(isNotEmptyArray(keepers) ? [`${menuText(user.locale, 'keepers')}: ${names(keepers)}`] : [])
    ];

    return {
        text: lines.join('\n'),
        keyboard: [...(isUpcoming ? actionRows(user, game, state) : []), navRow(user.locale, 'm:gl')]
    } satisfies Screen;
});

export const gameCardScreen = (user: MenuUser, sessionId: string, header: CardHeader | null) => gameCardPage(user, sessionId, header, 0);
