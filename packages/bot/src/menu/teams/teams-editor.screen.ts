import { isDefined, isNotEmptyArray, isNotEmptyString } from '@rnw-community/shared';
import { formatSessionLabel } from '@rondo/core/i18n/messages';
import { badgeOfColour } from '@rondo/core/teams/badges';
import { playersOf } from '@rondo/core/teams/draft-state';
import { solverInputFor, usualTeamCount } from '@rondo/core/teams/team-draft.service';
import { balanceOf, bestReturn, bestSwap } from '@rondo/core/teams/team-moves';
import { escapeHtml } from '@rondo/telegram/format/html';

import { buttonBudget } from '../../utils/button-budget.util';
import { fitLabel } from '../../utils/fit-label.util';
import { labelWidth } from '../../utils/label-width.util';
import { toShortId } from '../../utils/to-short-id.util';

import { teamsData, type TeamsBase } from './teams-callback';
import { isReasonKey, teamsCount, teamsText } from './teams-text';

import type { MenuButton, MenuUser, Screen } from '../screen.interface';
import type { EditorView } from './teams-view.interface';
import type { Locale } from '@rondo/core/i18n/locale';
import type { PlannedDelivery } from '@rondo/core/teams/interface/publish.interface';

const columnsShown = 3;
const pageSize = 2;
const buttonName = 12;

export const shortName = (name: string, limit = buttonName): string => (name.length > limit ? `${name.slice(0, limit - 1)}…` : name);

const chunkRows = (buttons: readonly MenuButton[], size: number): MenuButton[][] =>
    Array.from({ length: Math.ceil(buttons.length / size) }, (_row, index) => buttons.slice(index * size, index * size + size));

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

export const retryRows = (locale: Locale, base: TeamsBase, deliveries: readonly PlannedDelivery[]): MenuButton[][] =>
    deliveries.map(delivery => [
        {
            text: teamsText(locale, 'retryTo', { where: whereOf(locale, [delivery], 'to') }),
            callback_data: teamsData(base, 'Z', [ticketOf(delivery)])
        }
    ]);

export const sendLabel = (locale: Locale, deliveries: readonly PlannedDelivery[], isUpdate: boolean): string => {
    if (isUpdate && deliveries.every(delivery => delivery.chatId > 0n)) {
        return teamsText(locale, 'updateMe');
    }

    return teamsText(locale, isUpdate ? 'updateTo' : 'sendTo', { where: whereOf(locale, deliveries, 'to') });
};

const visibleTeams = (view: EditorView): number[] => {
    const all = view.row.state.teams.map((_members, team) => team);

    return all.length <= columnsShown ? all : all.slice(view.page * pageSize, view.page * pageSize + pageSize);
};

const playerButton = (view: EditorView, base: TeamsBase, personId: string, star: string | null): MenuButton => {
    const players = playersOf(view.row.state);
    const index = players.indexOf(personId);
    const isSelected = view.selected === personId;
    const marks = [
        isSelected ? '▶' : '',
        star === personId ? '⭐' : '',
        view.row.state.locks.includes(personId) ? '🔒' : '',
        view.row.state.keepers.includes(personId) ? '🧤' : ''
    ].join('');
    const label = `${marks}${isNotEmptyString(marks) ? ' ' : ''}${shortName(nameOf(view, personId))}`;

    if (isSelected) {
        return { text: label, callback_data: teamsData(base, 'd') };
    }

    return isDefined(view.selected)
        ? { text: label, callback_data: teamsData(base, 'w', [players.indexOf(view.selected), index]) }
        : { text: label, callback_data: teamsData(base, 's', [index]) };
};

const titleRow = (view: EditorView, base: TeamsBase): MenuButton[] => {
    const players = playersOf(view.row.state);

    return view.row.state.teams.map((members, team) => {
        const text = `${view.title === team ? '▶' : ''}${badgeAt(view, team)} ${members.length}`;

        if (isDefined(view.selected)) {
            return { text, callback_data: teamsData(base, 'm', [players.indexOf(view.selected), team]) };
        }

        return { text, callback_data: teamsData(base, view.title === team ? 'c' : 'T', [team]) };
    });
};

const playerRows = (view: EditorView, base: TeamsBase, star: string | null): MenuButton[][] => {
    const shown = visibleTeams(view);
    const depth = Math.max(0, ...shown.map(team => view.row.state.teams[team]?.length ?? 0));

    return Array.from({ length: depth }, (_row, position) =>
        shown.map(team => {
            const personId = view.row.state.teams[team]?.[position];

            return isDefined(personId) ? playerButton(view, base, personId, star) : { text: '·', callback_data: teamsData(base, 'e') };
        })
    );
};

const selectedRow = (user: MenuUser, view: EditorView, base: TeamsBase): MenuButton[][] => {
    if (!isDefined(view.selected)) {
        return [];
    }

    const index = playersOf(view.row.state).indexOf(view.selected);
    const isOnField = user.now.getTime() >= view.inputs.game.startsAt.getTime() - 30 * 60_000;

    return [
        [
            {
                text: teamsText(user.locale, view.row.state.locks.includes(view.selected) ? 'unlock' : 'lock'),
                callback_data: teamsData(base, 'l', [index])
            },
            { text: teamsText(user.locale, 'keeper'), callback_data: teamsData(base, 'k', [index]) },
            { text: teamsText(user.locale, 'deselect'), callback_data: teamsData(base, 'd') }
        ],
        [
            {
                text: teamsText(user.locale, isOnField ? 'noShow' : 'removeOne'),
                callback_data: teamsData(base, isOnField ? 'o' : 'r', [index])
            }
        ]
    ];
};

const textOf = (user: MenuUser, view: EditorView, uneven: string | null): string => {
    const { state } = view.row;
    const reason = state.reasons[state.variant] ?? '';
    const input = solverInputFor(view.inputs, state);
    const prompt = isDefined(view.selected)
        ? teamsText(user.locale, 'selected', { name: escapeHtml(nameOf(view, view.selected)) })
        : teamsText(user.locale, isDefined(view.title) ? 'titleSelected' : 'pick', {
              badge: isDefined(view.title) ? badgeAt(view, view.title) : ''
          });
    const sent = view.plan.deliveries.filter(delivery => delivery.stored === 'sent');
    const unsure = view.plan.deliveries.filter(delivery => isUnsure(delivery));

    return [
        teamsText(user.locale, 'title', { label: escapeHtml(formatSessionLabel(user.locale, view.inputs.game)) }),
        view.inputs.hasLevels ? `⚖️ ${balanceBar(balanceOf(input, state.teams))}` : teamsText(user.locale, 'noLevels'),
        ...(state.variant >= 0 && isReasonKey(reason)
            ? [
                  teamsText(user.locale, 'variant', {
                      number: state.variant + 1,
                      count: state.variants.length,
                      reason: teamsText(user.locale, reason)
                  })
              ]
            : []),
        ...(isNotEmptyArray(state.pending)
            ? [teamsText(user.locale, 'pending', { names: escapeHtml(state.pending.map(personId => nameOf(view, personId)).join(', ')) })]
            : []),
        ...view.notes,
        ...(view.offerLevels ? [teamsText(user.locale, 'nudge')] : []),
        prompt,
        ...(isDefined(uneven) ? [teamsText(user.locale, 'uneven')] : []),
        ...unsure.map(delivery => teamsText(user.locale, 'uncertain', { where: escapeHtml(whereOf(user.locale, [delivery], 'at')) })),
        isNotEmptyArray(sent)
            ? teamsText(user.locale, 'sent', { where: escapeHtml(whereOf(user.locale, sent, 'at')) })
            : teamsText(user.locale, 'quiet')
    ].join('\n');
};

export const editorScreen = (user: MenuUser, view: EditorView): Screen => {
    const { state } = view.row;
    const base = { sessionId: view.row.sessionId, version: view.row.version, page: view.page };
    const input = solverInputFor(view.inputs, state);
    const star = isDefined(view.selected) && view.inputs.hasLevels ? bestSwap(input, state.teams, view.selected) : null;
    const back = bestReturn(input, state.teams);
    const players = playersOf(state);
    const button = (key: Parameters<typeof teamsText>[1], op: string, args: readonly (string | number)[] = []): MenuButton => ({
        text: teamsText(user.locale, key),
        callback_data: teamsData(base, op, args)
    });
    const pages = Math.ceil(state.teams.length / pageSize);
    const suggestedCount = usualTeamCount(players.length);
    const due = view.plan.deliveries.filter(delivery => delivery.isDue);

    return {
        text: textOf(user, view, isDefined(back) ? back.personId : null),
        keyboard: fitRows([
            titleRow(view, base),
            ...playerRows(view, base, star),
            ...chunkRows(
                state.pending.map(personId => playerButton(view, base, personId, null)),
                columnsShown
            ),
            ...(isDefined(back)
                ? [
                      [
                          {
                              text: `↩️ ${shortName(nameOf(view, back.personId))} → ${badgeAt(view, back.team)}`,
                              callback_data: teamsData(base, 'm', [players.indexOf(back.personId), back.team])
                          }
                      ]
                  ]
                : []),
            ...selectedRow(user, view, base),
            ...(state.teams.length > columnsShown
                ? [
                      [
                          { text: '◀', callback_data: teamsData({ ...base, page: (view.page + pages - 1) % pages }, 'e') },
                          { text: `${view.page + 1}/${pages}`, callback_data: teamsData(base, 'e') },
                          { text: '▶', callback_data: teamsData({ ...base, page: (view.page + 1) % pages }, 'e') }
                      ]
                  ]
                : []),
            ...(state.variants.length > 1 && !isNotEmptyArray(state.pending)
                ? [
                      state.variants.map((_teams, variant) => ({
                          text: `${state.variant === variant ? '✓' : ''}${variant + 1}️⃣`,
                          callback_data: teamsData(base, 'v', [variant])
                      }))
                  ]
                : []),
            ...(view.offerLevels ? [[button('nudgeYes', 'L')], [button('nudgeLater', 'e')]] : []),
            [button('undo', 'u'), button('shuffle', 'h'), button('guest', 'g'), button('colour', 'c', [view.title ?? 0])],
            [button('joiners', 'j'), button('tiers', 'L')],
            ...(isNotEmptyArray(state.pending) ? [[button('place', 'b')]] : []),
            ...(suggestedCount === state.teams.length
                ? []
                : [
                      [
                          {
                              text: teamsText(user.locale, 'teamCount', { count: teamsCount(user.locale, suggestedCount) }),
                              callback_data: teamsData(base, 'n', [suggestedCount])
                          }
                      ]
                  ]),
            ...retryRows(
                user.locale,
                base,
                view.plan.deliveries.filter(delivery => isUnsure(delivery))
            ),
            ...(isNotEmptyArray(due)
                ? [[{ text: sendLabel(user.locale, due, view.plan.isUpdate), callback_data: teamsData(base, 'x') }]]
                : []),
            [{ text: teamsText(user.locale, 'back'), callback_data: `m:g:${toShortId(view.row.sessionId)}` }]
        ])
    };
};
