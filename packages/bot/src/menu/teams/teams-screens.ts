import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { formatSessionLabel } from '@rondo/core/i18n/messages';
import { badges } from '@rondo/core/teams/badges';
import { playersOf } from '@rondo/core/teams/draft-state';
import { escapeHtml } from '@rondo/telegram/format/html';

import { toShortId } from '../../utils/to-short-id.util';

import { teamsData, type TeamsBase } from './teams-callback';
import { badgeAt, nameOf, shortName } from './teams-editor.screen';
import { teamsText } from './teams-text';

import type { MenuButton, MenuUser, Screen } from '../screen.interface';
import type { EditorView } from './teams-view.interface';
import type { Tier } from '@rondo/core/teams/interface/team-inputs.interface';

const chunk = (buttons: readonly MenuButton[], size: number): MenuButton[][] =>
    Array.from({ length: Math.ceil(buttons.length / size) }, (_row, index) => buttons.slice(index * size, index * size + size));

const baseOf = (view: EditorView): TeamsBase => ({ sessionId: view.row.sessionId, version: view.row.version, page: view.page });

const backRow = (user: MenuUser, view: EditorView): MenuButton[] => [
    { text: teamsText(user.locale, 'toEditor'), callback_data: teamsData(baseOf(view), 'e') }
];

const header = (user: MenuUser, view: EditorView): string =>
    teamsText(user.locale, 'title', { label: escapeHtml(formatSessionLabel(user.locale, view.inputs.game)) });

export const guestHostScreen = (user: MenuUser, view: EditorView): Screen => {
    const players = playersOf(view.row.state);
    const hosts = view.inputs.members.filter(member => !member.isGuest && players.includes(member.personId));

    return {
        text: [header(user, view), teamsText(user.locale, 'guestHost')].join('\n'),
        keyboard: [
            ...chunk(
                hosts.map(member => ({
                    text: shortName(member.displayName, 16),
                    callback_data: teamsData(baseOf(view), 'G', [players.indexOf(member.personId)])
                })),
                3
            ),
            [{ text: teamsText(user.locale, 'noHost'), callback_data: teamsData(baseOf(view), 'G', ['n']) }],
            backRow(user, view)
        ]
    };
};

export const guestCountScreen = (user: MenuUser, view: EditorView, host: string): Screen => {
    const hostId = playersOf(view.row.state)[Number(host)];
    const hostName = isDefined(hostId) && host !== 'n' ? ` у ${escapeHtml(nameOf(view, hostId))}` : '';

    return {
        text: [header(user, view), teamsText(user.locale, 'guestCount', { host: hostName })].join('\n'),
        keyboard: [
            [1, 2, 3].map(count => ({ text: `+${count}`, callback_data: teamsData(baseOf(view), 'N', [host, count]) })),
            backRow(user, view)
        ]
    };
};

export const guestPlaceScreen = (
    user: MenuUser,
    view: EditorView,
    place: { readonly host: string; readonly count: number; readonly weakest: number }
): Screen => {
    const hostId = place.host === 'n' ? null : playersOf(view.row.state)[Number(place.host)];
    const hostTeam = isDefined(hostId) ? view.row.state.teams.findIndex(members => members.includes(hostId)) : -1;
    const toHost =
        isDefined(hostId) && hostTeam >= 0
            ? [
                  {
                      text: teamsText(user.locale, 'toHost', { badge: badgeAt(view, hostTeam), name: shortName(nameOf(view, hostId)) }),
                      callback_data: teamsData(baseOf(view), 'P', [place.host, place.count, hostTeam])
                  }
              ]
            : [];

    return {
        text: [header(user, view), teamsText(user.locale, 'guestPlace')].join('\n'),
        keyboard: [
            [
                ...toHost,
                {
                    text: teamsText(user.locale, 'toWeakest', { badge: badgeAt(view, place.weakest) }),
                    callback_data: teamsData(baseOf(view), 'P', [place.host, place.count, place.weakest])
                }
            ],
            backRow(user, view)
        ]
    };
};

export const removeScreen = (
    user: MenuUser,
    view: EditorView,
    ask: { readonly personId: string; readonly guests: number; readonly waiting: string | null }
): Screen => {
    const index = playersOf(view.row.state).indexOf(ask.personId);
    const name = nameOf(view, ask.personId);
    const options =
        ask.guests > 0
            ? [
                  {
                      text: teamsText(user.locale, 'withGuests', { count: ask.guests }),
                      callback_data: teamsData(baseOf(view), 'R', [index, 1])
                  },
                  {
                      text: teamsText(user.locale, 'onlyHost', { name: shortName(name) }),
                      callback_data: teamsData(baseOf(view), 'R', [index, 0])
                  }
              ]
            : [{ text: teamsText(user.locale, 'removeYes'), callback_data: teamsData(baseOf(view), 'R', [index, 0]) }];

    return {
        text: [
            header(user, view),
            teamsText(user.locale, 'removeAsk', { name: escapeHtml(name) }),
            ...(isDefined(ask.waiting) ? [teamsText(user.locale, 'waiting', { name: escapeHtml(ask.waiting) })] : [])
        ].join('\n'),
        keyboard: [options, backRow(user, view)]
    };
};

export const moveScreen = (
    user: MenuUser,
    view: EditorView,
    move: { readonly personId: string; readonly team: number; readonly guests: number }
): Screen => {
    const index = playersOf(view.row.state).indexOf(move.personId);
    const name = nameOf(view, move.personId);

    return {
        text: [header(user, view), teamsText(user.locale, 'moveAsk', { name: escapeHtml(name), count: move.guests })].join('\n'),
        keyboard: [
            [
                { text: teamsText(user.locale, 'moveAll'), callback_data: teamsData(baseOf(view), 'm', [index, move.team, 1]) },
                {
                    text: teamsText(user.locale, 'moveOne', { name: shortName(name) }),
                    callback_data: teamsData(baseOf(view), 'm', [index, move.team, 0])
                }
            ],
            backRow(user, view)
        ]
    };
};

export const colourScreen = (user: MenuUser, view: EditorView, team: number): Screen => ({
    text: [header(user, view), teamsText(user.locale, 'colourTitle', { badge: badgeAt(view, team) })].join('\n'),
    keyboard: [
        badges.map((badge, index) => ({
            text: view.row.state.colours[team] === badge.colour ? `✓${badge.badge}` : badge.badge,
            callback_data: teamsData(baseOf(view), 'C', [team, index])
        })),
        backRow(user, view)
    ]
});

const tierMark: Readonly<Record<Tier, string>> = { strong: '💪', normal: '🙂', new: '🌱' };

export const tiersScreen = (user: MenuUser, view: EditorView): Screen => {
    const players = playersOf(view.row.state);
    const members = view.inputs.members.filter(member => !member.isGuest && players.includes(member.personId));

    return {
        text: [header(user, view), teamsText(user.locale, 'tiersTitle')].join('\n'),
        keyboard: [
            ...chunk(
                members.map(member => ({
                    text: `${isDefined(member.tier) ? tierMark[member.tier] : '·'} ${shortName(member.displayName)}`,
                    callback_data: teamsData(baseOf(view), 'Y', [players.indexOf(member.personId)])
                })),
                2
            ),
            backRow(user, view)
        ]
    };
};

export const joinersScreen = (
    user: MenuUser,
    view: EditorView,
    candidates: readonly { readonly personId: string; readonly displayName: string }[]
): Screen => ({
    text: [header(user, view), teamsText(user.locale, isNotEmptyArray(candidates) ? 'joinTitle' : 'noJoiners')].join('\n'),
    keyboard: [
        ...chunk(
            candidates.map(candidate => ({
                text: shortName(candidate.displayName, 16),
                callback_data: teamsData(baseOf(view), 'J', [toShortId(candidate.personId)])
            })),
            2
        ),
        [{ text: teamsText(user.locale, 'guest'), callback_data: teamsData(baseOf(view), 'g') }],
        backRow(user, view)
    ]
});
