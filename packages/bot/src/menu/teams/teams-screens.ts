import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { formatSessionLabel } from '@rondo/core/i18n/messages';
import { badges } from '@rondo/core/teams/badges';
import { playersOf } from '@rondo/core/teams/draft-state';
import { teamName } from '@rondo/core/teams/lineup-post';
import { usualTeamCount } from '@rondo/core/teams/team-draft.service';
import { escapeHtml } from '@rondo/telegram/format/html';

import { toShortId } from '../../utils/to-short-id.util';

import { teamsData, type TeamsBase } from './teams-callback';
import { badgeAt, buttonNames, nameOf, queueLine, shortName, teamAt } from './teams-editor.screen';
import { teamsCount, teamsText } from './teams-text';

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
    teamsText(user.locale, 'editorTitle', { label: escapeHtml(formatSessionLabel(user.locale, view.inputs.game)) });

export const guestCountScreen = (user: MenuUser, view: EditorView, host: string): Screen => {
    const hostId = playersOf(view.row.state)[Number(host)];

    return {
        text: [header(user, view), teamsText(user.locale, 'guestCount', { name: escapeHtml(nameOf(view, hostId ?? '')) })].join('\n'),
        keyboard: [
            [1, 2, 3].map(count => ({ text: `+${count}`, callback_data: teamsData(baseOf(view), 'P', [host, count]) })),
            backRow(user, view)
        ]
    };
};

export const fullAsk = (
    user: MenuUser,
    view: EditorView,
    ask: {
        readonly who: string;
        readonly taken: number;
        readonly limit: number;
        readonly op: string;
        readonly args: readonly (string | number)[];
    }
): Screen => ({
    text: [
        header(user, view),
        teamsText(user.locale, 'fullAsk', { taken: ask.taken, limit: ask.limit, name: escapeHtml(ask.who) }),
        ...queueLine(user.locale, view.waiting)
    ].join('\n'),
    keyboard: [
        [{ text: teamsText(user.locale, 'toQueue'), callback_data: teamsData(baseOf(view), ask.op, [...ask.args, 0]) }],
        [{ text: teamsText(user.locale, 'overLimit'), callback_data: teamsData(baseOf(view), ask.op, [...ask.args, 1]) }],
        backRow(user, view)
    ]
});

export const removeScreen = (
    user: MenuUser,
    view: EditorView,
    ask: { readonly personId: string; readonly guests: number; readonly waiting: string | null; readonly hasStarted: boolean }
): Screen => {
    const index = playersOf(view.row.state).indexOf(ask.personId);
    const name = nameOf(view, ask.personId);
    const remove = (key: 'withGuests' | 'onlyHost' | 'removeYes' | 'withdrew', guests: number): MenuButton => ({
        text: teamsText(user.locale, key, { count: ask.guests, name: shortName(name) }),
        callback_data: teamsData(baseOf(view), 'R', [index, guests])
    });
    const options =
        ask.guests > 0 ? [remove('withGuests', 1), remove('onlyHost', 0)] : [remove(ask.hasStarted ? 'withdrew' : 'removeYes', 0)];

    return {
        text: [
            header(user, view),
            teamsText(user.locale, 'removeAsk', { name: escapeHtml(name) }),
            ...(isDefined(ask.waiting) ? [teamsText(user.locale, 'waiting', { name: escapeHtml(ask.waiting) })] : [])
        ].join('\n'),
        keyboard: [
            ...(ask.hasStarted ? [[{ text: teamsText(user.locale, 'noShow'), callback_data: teamsData(baseOf(view), 'o', [index]) }]] : []),
            ...options.map(option => [option]),
            backRow(user, view)
        ]
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
    text: [
        header(user, view),
        teamsText(user.locale, 'colourTitle', { team: `${badgeAt(view, team)} ${teamAt(user.locale, view, team)}` })
    ].join('\n'),
    keyboard: [
        ...chunk(
            badges.map((badge, index) => ({
                text: `${view.row.state.colours[team] === badge.colour ? '✓' : ''}${badge.badge} ${teamName(user.locale, badge.badge, index)}`,
                callback_data: teamsData(baseOf(view), 'C', [team, index])
            })),
            2
        ),
        [{ text: teamsText(user.locale, 'toSettings'), callback_data: teamsData(baseOf(view), 'L') }]
    ]
});

const tierMark: Readonly<Record<Tier, string>> = { strong: '💪', normal: '🙂', new: '🌱' };

export const settingsScreen = (user: MenuUser, view: EditorView): Screen => {
    const players = playersOf(view.row.state);
    const members = view.inputs.members.filter(member => !member.isGuest && players.includes(member.personId));
    const labels = buttonNames(members.map(member => member.displayName));
    const count = view.row.state.teams.length;
    const counts = [2, 3, 4].filter(entry => entry !== count && entry <= Math.max(2, usualTeamCount(players.length) + 1));

    return {
        text: [header(user, view), teamsText(user.locale, 'settingsTitle')].join('\n'),
        keyboard: [
            ...chunk(
                members.map(member => ({
                    text: `${isDefined(member.tier) ? `${tierMark[member.tier]} ` : ''}${labels.get(member.displayName) ?? member.displayName}`,
                    callback_data: teamsData(baseOf(view), 'Y', [players.indexOf(member.personId)])
                })),
                2
            ),
            ...chunk(
                view.row.state.teams.map((_members, team) => ({
                    text: teamsText(user.locale, 'colourOf', { team: `${badgeAt(view, team)} ${teamAt(user.locale, view, team)}` }),
                    callback_data: teamsData(baseOf(view), 'c', [team])
                })),
                2
            ),
            counts.map(entry => ({
                text: teamsText(user.locale, 'teamCount', { count: teamsCount(user.locale, entry) }),
                callback_data: teamsData(baseOf(view), 'n', [entry])
            })),
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
        ...candidates.map(candidate => [
            { text: candidate.displayName, callback_data: teamsData(baseOf(view), 'J', [toShortId(candidate.personId)]) }
        ]),
        [{ text: teamsText(user.locale, 'writeName'), callback_data: teamsData(baseOf(view), 'g') }],
        backRow(user, view)
    ]
});

export const namePrompt = (user: MenuUser, view: EditorView): Screen => ({
    text: [header(user, view), teamsText(user.locale, 'namePrompt')].join('\n'),
    keyboard: [backRow(user, view)]
});
