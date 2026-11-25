import { isDefined, isNotEmptyArray, isNotEmptyString } from '@rnw-community/shared';
import { formatSessionLabel } from '@rondo/core/i18n/messages';
import { badgeOfColour } from '@rondo/core/teams/badges';
import { playersOf } from '@rondo/core/teams/draft-state';
import { teamName } from '@rondo/core/teams/lineup-post';
import { solverInputFor } from '@rondo/core/teams/team-draft.service';
import { balanceOf, bestReturn } from '@rondo/core/teams/team-moves';
import { escapeHtml } from '@rondo/telegram/format/html';

import { buttonBudget } from '../../utils/button-budget.util';
import { fitLabel } from '../../utils/fit-label.util';
import { labelWidth } from '../../utils/label-width.util';

import { teamsData, type TeamsBase } from './teams-callback';
import { teamsText, towardsTeam } from './teams-text';

import type { MenuButton, MenuUser, Screen } from '../screen.interface';
import type { EditorView } from './teams-view.interface';
import type { Locale } from '@rondo/core/i18n/locale';
import type { PlannedDelivery } from '@rondo/core/teams/interface/publish.interface';

const pageSize = 2;
const guestNumber = /^(?<host>.+) (?<number>\+\d+)$/u;

export const shortName = (name: string, limit = 12): string => (name.length > limit ? `${name.slice(0, limit - 1)}…` : name);

const initialsOf = (name: string, letters: number): string => {
    const guest = guestNumber.exec(name)?.groups;
    const [first = '', second] = (guest?.host ?? name).split(/\s+/u);
    const short = isDefined(second) ? `${first} ${second.slice(0, letters)}.` : first;

    return isDefined(guest) ? `${short} ${guest.number}` : short;
};

const buttonNames = (names: readonly string[]): Map<string, string> => {
    const labels = new Map<string, string>();

    for (const name of names) {
        const short = initialsOf(name, 1);
        const clashes = names.filter(other => other !== name && initialsOf(other, 1) === short);
        labels.set(name, isNotEmptyArray(clashes) ? initialsOf(name, 4) : short);
    }

    return labels;
};

const fitRows = (rows: readonly (readonly MenuButton[])[]): MenuButton[][] =>
    rows.map(row => row.map(button => ({ text: fitLabel(button.text, buttonBudget(row.length)), callback_data: button.callback_data })));

export const stackRows = (rows: readonly (readonly MenuButton[])[]): MenuButton[][] =>
    fitRows(
        rows.flatMap(row =>
            row.every(button => labelWidth(button.text) <= buttonBudget(row.length)) ? [row] : row.map(button => [button])
        )
    );

const balanceBar = (balance: number): string => {
    const filled = Math.round(balance * 5);

    return `${'▰'.repeat(filled)}${'▱'.repeat(5 - filled)}`;
};

export const badgeAt = (view: Pick<EditorView, 'row'>, team: number): string =>
    badgeOfColour(view.row.state.colours[team])?.badge ?? `${team + 1}.`;

export const teamAt = (locale: Locale, view: Pick<EditorView, 'row'>, team: number): string => teamName(locale, badgeAt(view, team), team);

export const nameOf = (view: Pick<EditorView, 'inputs'>, personId: string): string =>
    view.inputs.members.find(member => member.personId === personId)?.displayName ?? '?';

type Destination = Pick<PlannedDelivery, 'chatId' | 'title'>;

export const isUnsure = (delivery: PlannedDelivery): boolean => delivery.stored === 'claimed' || delivery.stored === 'uncertain';

export const ticketOf = (delivery: PlannedDelivery): string => (delivery.token ?? '').slice(0, 8);

export const whereOf = (locale: Locale, deliveries: readonly Destination[], form: 'to' | 'at'): string =>
    deliveries
        .map(delivery =>
            delivery.chatId > 0n
                ? teamsText(locale, form === 'to' ? 'toMe' : 'atMe')
                : teamsText(locale, 'inGroup', { title: delivery.title ?? '' })
        )
        .join(teamsText(locale, 'and'));

export const sendLabel = (locale: Locale, deliveries: readonly PlannedDelivery[], isUpdate: boolean): string => {
    if (isUpdate && deliveries.every(delivery => delivery.chatId > 0n)) {
        return teamsText(locale, 'updateMe');
    }

    if (deliveries.length > 1) {
        return teamsText(locale, isUpdate ? 'updateAll' : 'sendAll');
    }

    return teamsText(locale, isUpdate ? 'updateTo' : 'sendTo', { where: whereOf(locale, deliveries, 'to') });
};

export const statusLines = (user: MenuUser, view: EditorView): string[] => {
    const sent = view.plan.deliveries.filter(delivery => delivery.stored === 'sent');
    const where = (deliveries: readonly PlannedDelivery[]) => escapeHtml(whereOf(user.locale, deliveries, 'at'));

    return [
        ...(isNotEmptyArray(view.waiting) ? [teamsText(user.locale, 'queue', { names: escapeHtml(view.waiting.join(', ')) })] : []),
        ...view.plan.deliveries
            .filter(delivery => isUnsure(delivery))
            .map(delivery => teamsText(user.locale, 'uncertain', { where: where([delivery]) })),
        ...view.plan.deliveries
            .filter(delivery => delivery.stored === 'busy')
            .map(delivery => teamsText(user.locale, 'busy', { where: where([delivery]) })),
        isNotEmptyArray(sent) ? teamsText(user.locale, 'sent', { where: where(sent) }) : teamsText(user.locale, 'quiet')
    ];
};

const visibleTeams = (view: EditorView): number[] =>
    view.row.state.teams.map((_members, team) => team).slice(view.page * pageSize, view.page * pageSize + pageSize);

const playerButton = (view: EditorView, base: TeamsBase, labels: ReadonlyMap<string, string>, personId: string): MenuButton => {
    const index = playersOf(view.row.state).indexOf(personId);
    const marks = [view.row.state.locks.includes(personId) ? '🔒' : '', view.row.state.keepers.includes(personId) ? '🧤' : ''].join('');
    const name = labels.get(nameOf(view, personId)) ?? nameOf(view, personId);
    const isSelected = view.selected === personId;
    const text = `${isSelected ? '▶ ' : ''}${marks}${isNotEmptyString(marks) ? ' ' : ''}${name}`;

    if (isSelected) {
        return { text, callback_data: teamsData(base, 'd') };
    }

    return {
        text,
        callback_data: isDefined(view.selected)
            ? teamsData(base, 'w', [playersOf(view.row.state).indexOf(view.selected), index])
            : teamsData(base, 's', [index])
    };
};

const titleRow = (user: MenuUser, view: EditorView, base: TeamsBase): MenuButton[] => {
    const { teams } = view.row.state;
    const selectedTeam = isDefined(view.selected) ? teams.findIndex(members => members.includes(view.selected ?? '')) : -1;
    const selectedIndex = playersOf(view.row.state).indexOf(view.selected ?? '');

    return visibleTeams(view).map(team => {
        const title = `${badgeAt(view, team)} ${teamAt(user.locale, view, team)} · ${teams[team]?.length ?? 0}`;

        if (!isDefined(view.selected) || team === selectedTeam) {
            return { text: title, callback_data: teamsData(base, isDefined(view.selected) ? 'd' : 'e') };
        }

        return { text: towardsTeam(user.locale, badgeAt(view, team)), callback_data: teamsData(base, 'm', [selectedIndex, team]) };
    });
};

const playerRows = (view: EditorView, base: TeamsBase, labels: ReadonlyMap<string, string>): MenuButton[][] => {
    const shown = visibleTeams(view).map(team => view.row.state.teams[team] ?? []);
    const depth = Math.max(0, ...shown.map(members => members.length));

    return Array.from({ length: depth }, (_row, row) =>
        shown.map(members => {
            const personId = members[row];

            return isDefined(personId) ? playerButton(view, base, labels, personId) : { text: '·', callback_data: teamsData(base, 'e') };
        })
    );
};

const selectedRows = (user: MenuUser, view: EditorView, base: TeamsBase): MenuButton[][] => {
    const selected = view.selected ?? '';
    const index = playersOf(view.row.state).indexOf(selected);
    const button = (key: Parameters<typeof teamsText>[1], op: string, values: Readonly<Record<string, string>> = {}): MenuButton => ({
        text: teamsText(user.locale, key, values),
        callback_data: teamsData(base, op, [index])
    });
    const member = view.inputs.members.find(entry => entry.personId === selected);

    return [
        [
            button(view.row.state.keepers.includes(selected) ? 'keeperOff' : 'keeperOn', 'k'),
            button(view.row.state.locks.includes(selected) ? 'lockOff' : 'lockOn', 'l')
        ],
        [
            button('out', 'r'),
            ...(member?.isGuest === true ? [] : [button('guestOf', 'G', { name: initialsOf(nameOf(view, selected), 1) })])
        ],
        [{ text: teamsText(user.locale, 'deselect'), callback_data: teamsData(base, 'd') }]
    ];
};

const pageRow = (user: MenuUser, view: EditorView): MenuButton[][] => {
    const pages = Math.ceil(view.row.state.teams.length / pageSize);

    if (pages < 2) {
        return [];
    }

    const next = (view.page + 1) % pages;
    const others = view.row.state.teams.map((_members, team) => team).slice(next * pageSize, next * pageSize + pageSize);
    const badges = others.map(team => badgeAt(view, team)).join('');

    return [
        [
            {
                text: teamsText(user.locale, others.length > 1 ? 'otherTeams' : 'otherTeam', { badges }),
                callback_data: teamsData({ sessionId: view.row.sessionId, version: view.row.version, page: next }, 'e')
            }
        ]
    ];
};

const keepersLine = (user: MenuUser, view: EditorView): string[] => {
    const { teams, keepers } = view.row.state;
    const counts = teams.map(members => members.filter(personId => keepers.includes(personId)).length);
    const total = counts.reduce((sum, count) => sum + count, 0);
    const isSpread = counts.every(count => count >= Math.floor(total / teams.length) && count <= Math.ceil(total / teams.length));

    return isSpread
        ? []
        : [teamsText(user.locale, 'keepersUneven', { counts: counts.map((count, team) => `${badgeAt(view, team)} ${count}`).join(' · ') })];
};

const textOf = (user: MenuUser, view: EditorView, isUneven: boolean): string => {
    const input = solverInputFor(view.inputs, view.row.state);
    const { selected } = view;
    const selectedTeam = isDefined(selected) ? view.row.state.teams.findIndex(members => members.includes(selected)) : -1;
    const prompt = isDefined(selected)
        ? teamsText(user.locale, 'picked', {
              name: escapeHtml(nameOf(view, selected)),
              team: selectedTeam >= 0 ? teamAt(user.locale, view, selectedTeam) : teamsText(user.locale, 'notPlaced')
          })
        : teamsText(user.locale, 'pick');

    return [
        teamsText(user.locale, 'editorTitle', { label: escapeHtml(formatSessionLabel(user.locale, view.inputs.game)) }),
        ...view.notes,
        ...(isNotEmptyArray(view.row.state.pending)
            ? [
                  teamsText(user.locale, 'pending', {
                      names: escapeHtml(view.row.state.pending.map(personId => nameOf(view, personId)).join(', '))
                  })
              ]
            : []),
        prompt,
        ...(isUneven ? [teamsText(user.locale, 'uneven')] : []),
        ...keepersLine(user, view),
        ...(view.inputs.hasLevels ? [`⚖️ ${balanceBar(balanceOf(input, view.row.state.teams))}`] : []),
        ...statusLines(user, view)
    ].join('\n');
};

export const editorScreen = (user: MenuUser, view: EditorView): Screen => {
    const { state } = view.row;
    const base = { sessionId: view.row.sessionId, version: view.row.version, page: view.page };
    const back = bestReturn(solverInputFor(view.inputs, state), state.teams);
    const players = playersOf(state);
    const labels = buttonNames(players.map(personId => nameOf(view, personId)));
    const button = (key: Parameters<typeof teamsText>[1], op: string, args: readonly (string | number)[] = []): MenuButton => ({
        text: teamsText(user.locale, key),
        callback_data: teamsData(base, op, args)
    });
    const pending = state.pending.map(personId => playerButton(view, base, labels, personId));
    const actions = isDefined(view.selected)
        ? selectedRows(user, view, base)
        : [
              ...(isDefined(back)
                  ? [
                        [
                            {
                                text: teamsText(user.locale, 'even', {
                                    name: labels.get(nameOf(view, back.personId)) ?? '',
                                    team: teamAt(user.locale, view, back.team)
                                }),
                                callback_data: teamsData(base, 'm', [players.indexOf(back.personId), back.team])
                            }
                        ]
                    ]
                  : []),
              ...(isNotEmptyArray(state.pending) ? [[button('place', 'b')]] : []),
              ...pageRow(user, view),
              [
                  ...(isNotEmptyArray(state.history) ? [button('undoLast', 'u')] : []),
                  button(isNotEmptyArray(state.locks) ? 'shuffleRest' : 'shuffleAll', 'h')
              ],
              [button('someone', 'j'), button('settings', 'L')],
              [button('done', 'O')]
          ];

    return {
        text: textOf(user, view, isDefined(back)),
        keyboard: [
            ...fitRows([
                titleRow(user, view, base),
                ...playerRows(view, base, labels),
                ...Array.from({ length: Math.ceil(pending.length / pageSize) }, (_row, row) =>
                    pending.slice(row * pageSize, row * pageSize + pageSize)
                )
            ]),
            ...stackRows(actions)
        ]
    };
};
