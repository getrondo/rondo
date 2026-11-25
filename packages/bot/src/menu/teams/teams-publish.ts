import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { groupLocaleOf, mainGroupOf } from '@rondo/core/community/community.repository';
import { approverOf, isApproverOf } from '@rondo/core/community/group-settings';
import { publishLineup } from '@rondo/core/teams/publish-lineup';
import { publishTeamsAction } from '@rondo/core/teams/team.service';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { toShortId } from '../../utils/to-short-id.util';
import { menuText } from '../menu-text';
import { runConfirmed } from '../run-confirmed';

import { teamsData, type TeamsTap } from './teams-callback';
import { isUnsure, sendLabel, statusLines, ticketOf, whereOf } from './teams-editor.screen';
import { teamsText } from './teams-text';
import { actorOf, loadView, planOf, showTeams } from './teams-view';

import type { MenuButton, MenuUser, Screen } from '../screen.interface';
import type { EditorView } from './teams-view.interface';
import type { DeliveryOutcome, PlannedDelivery } from '@rondo/core/teams/interface/publish.interface';

// Second argument of a send tap: a ticket of an unknown delivery, or this mark for a new message instead of an edit
const asNewMessage = 'n';

const sendRows = (user: MenuUser, view: EditorView, due: readonly PlannedDelivery[]): MenuButton[][] => {
    const base = { sessionId: view.row.sessionId, version: view.row.version, page: 0 };
    const { fingerprint } = view.plan;

    if (!isNotEmptyArray(due)) {
        return [];
    }

    // After a refused edit the admin chooses: a new message, or the edit once more
    return isNotEmptyArray(view.after?.refused ?? [])
        ? [
              [{ text: teamsText(user.locale, 'sendAsNew'), callback_data: teamsData(base, 'X', [fingerprint, asNewMessage]) }],
              [{ text: teamsText(user.locale, 'editAgain'), callback_data: teamsData(base, 'X', [fingerprint]) }]
          ]
        : [[{ text: sendLabel(user.locale, due, view.plan.isUpdate), callback_data: teamsData(base, 'X', [fingerprint]) }]];
};

export const overviewScreen = Effect.fn('Bot.teamsOverview')(function* (user: MenuUser, view: EditorView) {
    const { plan, row } = view;
    const due = plan.deliveries.filter(delivery => delivery.isDue);
    const base = { sessionId: row.sessionId, version: row.version, page: 0 };
    const retries: MenuButton[][] = [];

    for (const delivery of plan.deliveries.filter(entry => !entry.isDue && isUnsure(entry))) {
        const retry = yield* planOf(user, view, ticketOf(delivery));
        retries.push([
            {
                text: teamsText(user.locale, 'retryTo', { where: whereOf(user.locale, [delivery], 'to') }),
                callback_data: teamsData(base, 'X', [retry.fingerprint, ticketOf(delivery)])
            }
        ]);
    }

    const variant = row.state.variant >= 0 ? { number: row.state.variant + 1, count: row.state.variants.length } : null;
    const hasVariants = row.state.variants.length > 1;

    return {
        text: [
            due[0]?.html ?? plan.deliveries[0]?.html ?? '',
            '',
            ...view.notes,
            ...(isNotEmptyArray(plan.diff) && plan.isUpdate ? [teamsText(user.locale, 'changes'), escapeHtml(plan.diff.join('\n'))] : []),
            ...(plan.clearsResult ? [teamsText(user.locale, 'clearsResult')] : []),
            ...(due.length > 1 ? [teamsText(user.locale, 'sendsTo', { where: escapeHtml(whereOf(user.locale, due, 'to')) })] : []),
            ...(view.offerLevels ? [teamsText(user.locale, 'nudge')] : []),
            ...statusLines(user, view)
        ].join('\n'),
        keyboard: [
            ...sendRows(user, view, due),
            ...retries,
            [{ text: teamsText(user.locale, 'editSquads'), callback_data: teamsData(base, 'e') }],
            [
                ...(hasVariants
                    ? [
                          {
                              text: isDefined(variant)
                                  ? teamsText(user.locale, 'nextVariant', variant)
                                  : teamsText(user.locale, 'nextVariantPlain'),
                              callback_data: teamsData(base, 'V')
                          }
                      ]
                    : []),
                { text: teamsText(user.locale, 'someone'), callback_data: teamsData(base, 'j') }
            ],
            ...(view.offerLevels
                ? [
                      [
                          { text: teamsText(user.locale, 'nudgeYes'), callback_data: teamsData(base, 'L') },
                          { text: teamsText(user.locale, 'nudgeLater'), callback_data: teamsData(base, 'O') }
                      ]
                  ]
                : []),
            [{ text: teamsText(user.locale, 'toGame'), callback_data: `m:g:${toShortId(row.sessionId)}` }]
        ]
    } satisfies Screen;
});

const refusedKey = (outcome: DeliveryOutcome) => {
    if (outcome.failure?.code === 'message_gone') {
        return 'refusedGone' as const;
    }

    return outcome.isEdit ? ('refusedEdit' as const) : ('refusedSend' as const);
};

const outcomeNote = (user: MenuUser, outcome: DeliveryOutcome): string | null => {
    const where = escapeHtml(whereOf(user.locale, [outcome], 'at'));
    const notes: Readonly<Record<DeliveryOutcome['status'], () => string | null>> = {
        sent: () => (outcome.chatId > 0n ? teamsText(user.locale, 'hint') : teamsText(user.locale, 'doneGroup', { where })),
        edited: () => teamsText(user.locale, 'editedGroup', { where }),
        refused: () => teamsText(user.locale, refusedKey(outcome), { where }),
        uncertain: () => null,
        busy: () => null,
        unchanged: () => null
    };

    return notes[outcome.status]();
};

// Another admin's line-up for a group goes to the approver as a proposal of exactly this post
const askForTeams = Effect.fn('Bot.askForTeams')(function* (user: MenuUser, view: EditorView, isRepeat: boolean) {
    const approver = yield* approverOf(user.communityId);
    const name = Option.match(approver, { onNone: () => '', onSome: found => found.name });

    if (isRepeat) {
        return menuText(user.locale, 'onlyApprover', { name: escapeHtml(name) });
    }

    const { row, inputs } = view;
    const nameOf = new Map(inputs.members.map(member => [member.personId, member.displayName]));
    const action = yield* publishTeamsAction({
        communityId: user.communityId,
        sessionId: row.sessionId,
        teams: row.state.teams.map((members, index) => ({
            ordinal: index + 1,
            players: members.map(personId => ({
                personId,
                displayName: nameOf.get(personId) ?? '',
                isGk: row.state.keepers.includes(personId)
            }))
        })),
        teamCount: null,
        locale: yield* groupLocaleOf(user.communityId),
        privateChatId: user.chatId,
        fallback: yield* mainGroupOf(user.communityId),
        actorPersonId: yield* actorOf(user)
    });
    const outcome = yield* runConfirmed(user, action, { summary: null, target: { where: '', isPrivate: false } });

    return outcome._tag === 'done' ? '' : outcome.text;
});

export const publishAndShow = Effect.fn('Bot.publishAndShow')(function* (user: MenuUser, tap: TeamsTap, messageId: number) {
    const [fingerprint, ticket] = tap.args;
    const isNew = ticket === asNewMessage;
    const view = yield* loadView(user, tap.sessionId);
    const isToGroup = view.plan.deliveries.some(delivery => delivery.chatId < 0n && (delivery.isDue || isDefined(ticket)));

    if (isToGroup && view.plan.fingerprint === fingerprint && !(yield* isApproverOf(user.tgUserId, user.communityId))) {
        const note = yield* askForTeams(user, view, isDefined(ticket));
        const asked = yield* loadView(user, tap.sessionId, { notes: [note] });

        return yield* showTeams(user, messageId, { sessionId: tap.sessionId, screen: yield* overviewScreen(user, asked) });
    }

    const published = yield* publishLineup({
        communityId: user.communityId,
        sessionId: tap.sessionId,
        version: tap.version,
        fingerprint: fingerprint ?? '',
        retryToken: isNew ? null : (ticket ?? null),
        asNewMessage: isNew,
        locale: yield* groupLocaleOf(user.communityId),
        actorPersonId: yield* actorOf(user),
        approval: { _tag: 'approver', tgUserId: user.tgUserId },
        privateChatId: user.chatId,
        fallback: yield* mainGroupOf(user.communityId)
    }).pipe(
        Effect.catchTag('ActionFailedError', failure =>
            failure.failure.code === 'lineup_changed' ? Effect.succeed(null) : Effect.fail(failure)
        )
    );

    if (!isDefined(published)) {
        const fresh = yield* loadView(user, tap.sessionId, { place: true });
        const changes = fresh.joinedNames.length + fresh.leftNames.length > 0;
        const isDone = !fresh.plan.deliveries.some(delivery => delivery.isDue);
        const note = changes
            ? teamsText(user.locale, 'rosterChanged', {
                  changes: escapeHtml(
                      [...fresh.joinedNames.map(name => `+ ${name}`), ...fresh.leftNames.map(name => `− ${name}`)].join(', ')
                  )
              })
            : teamsText(user.locale, 'changedPreview');

        return yield* showTeams(user, messageId, {
            sessionId: tap.sessionId,
            screen: yield* overviewScreen(user, {
                ...fresh,
                notes: isDone && !changes ? [] : [note],
                after: { receipts: [], refused: [], isRefresh: !isDone || changes }
            })
        });
    }

    const notes = published.deliveries.flatMap(outcome => outcomeNote(user, outcome) ?? []);
    const receipts = published.deliveries.flatMap(outcome =>
        outcome.status === 'sent' || outcome.status === 'edited' ? [outcome.chatId] : []
    );
    const refused = published.deliveries.flatMap(outcome =>
        outcome.status === 'refused' && refusedKey(outcome) === 'refusedEdit' ? [outcome.chatId] : []
    );
    const fresh = yield* loadView(user, tap.sessionId, { notes, after: { receipts, refused, isRefresh: false } });

    return yield* showTeams(user, messageId, { sessionId: tap.sessionId, screen: yield* overviewScreen(user, fresh) });
});
