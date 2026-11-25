import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { groupLocaleOf, mainGroupOf } from '@rondo/core/community/community.repository';
import { formatSessionLabel } from '@rondo/core/i18n/messages';
import { lineupChanged, publishLineup } from '@rondo/core/teams/publish-lineup';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';

import { showScreen } from '../show-screen';

import { teamsData, type TeamsTap } from './teams-callback';
import { editorScreen, isUnsure, retryRows, sendLabel, ticketOf, whereOf } from './teams-editor.screen';
import { teamsText } from './teams-text';
import { actorOf, loadView, planOf, showTeams } from './teams-view';

import type { MenuUser, Screen } from '../screen.interface';
import type { EditorView } from './teams-view.interface';
import type { DeliveryOutcome } from '@rondo/core/teams/interface/publish.interface';

export const previewScreen = (user: MenuUser, view: EditorView, notes: readonly string[] = []): Screen => {
    const { plan } = view;
    const due = plan.deliveries.filter(delivery => delivery.isDue);
    const unsure = plan.deliveries.filter(delivery => !delivery.isDue && isUnsure(delivery));
    const retry = due.find(delivery => isUnsure(delivery));
    const base = { sessionId: view.row.sessionId, version: view.row.version, page: view.page };
    const where = (deliveries: typeof due, form: 'to' | 'at') => escapeHtml(whereOf(user.locale, deliveries, form));

    return {
        text: [
            teamsText(user.locale, 'title', { label: escapeHtml(formatSessionLabel(user.locale, view.inputs.game)) }),
            ...notes,
            ...(isNotEmptyArray(due) ? [teamsText(user.locale, 'sees', { where: where(due, 'at') })] : []),
            `<blockquote>${due[0]?.html ?? plan.deliveries[0]?.html ?? ''}</blockquote>`,
            ...(isNotEmptyArray(plan.diff) ? [teamsText(user.locale, 'changes'), escapeHtml(plan.diff.join('\n'))] : []),
            ...(plan.clearsResult ? [teamsText(user.locale, 'clearsResult')] : []),
            ...unsure.map(delivery => teamsText(user.locale, 'uncertain', { where: where([delivery], 'at') })),
            teamsText(user.locale, isNotEmptyArray(due) ? 'quiet' : 'unchanged')
        ].join('\n'),
        keyboard: [
            ...(isNotEmptyArray(due)
                ? [
                      [
                          {
                              text: isDefined(retry)
                                  ? teamsText(user.locale, 'retryTo', { where: whereOf(user.locale, due, 'to') })
                                  : sendLabel(user.locale, due, plan.isUpdate),
                              callback_data: teamsData(base, 'X', [plan.fingerprint, ...(isDefined(retry) ? [ticketOf(retry)] : [])])
                          }
                      ]
                  ]
                : []),
            ...retryRows(user.locale, base, unsure),
            [{ text: teamsText(user.locale, 'toEditor'), callback_data: teamsData(base, 'e') }]
        ]
    };
};

export const retryPreview = Effect.fn('Bot.teamsRetryPreview')(function* (user: MenuUser, view: EditorView, ticket: string) {
    return previewScreen(user, { ...view, plan: yield* planOf(user, view, ticket) });
});

const notFound = /message to edit not found/iu;

const refusedKey = (outcome: DeliveryOutcome) => {
    if (notFound.test(outcome.reason ?? '')) {
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
        busy: () => teamsText(user.locale, 'busy', { where }),
        unchanged: () => null
    };

    return notes[outcome.status]();
};

export const publishAndShow = Effect.fn('Bot.publishAndShow')(function* (user: MenuUser, tap: TeamsTap, messageId: number) {
    const [fingerprint, ticket] = tap.args;
    const published = yield* publishLineup({
        communityId: user.communityId,
        sessionId: tap.sessionId,
        version: tap.version,
        fingerprint: fingerprint ?? '',
        retryToken: ticket ?? null,
        locale: yield* groupLocaleOf(user.communityId),
        actorPersonId: yield* actorOf(user),
        privateChatId: user.chatId,
        fallback: yield* mainGroupOf(user.communityId)
    }).pipe(
        Effect.catchTag('ActionFailedError', failure => (failure.reason === lineupChanged ? Effect.succeed(null) : Effect.fail(failure)))
    );

    if (!isDefined(published)) {
        const fresh = yield* loadView(user, tap.sessionId, { page: tap.page });
        const isDone = !fresh.plan.deliveries.some(delivery => delivery.isDue);

        return yield* showTeams(user, messageId, {
            sessionId: tap.sessionId,
            screen: isDone
                ? editorScreen(user, { ...fresh, notes: [teamsText(user.locale, 'unchanged')] })
                : previewScreen(user, fresh, [teamsText(user.locale, 'changedPreview')])
        });
    }

    const notes = published.deliveries.flatMap(outcome => outcomeNote(user, outcome) ?? []);
    const toMe = published.deliveries.some(outcome => outcome.chatId > 0n && outcome.status === 'sent');
    const diff = toMe && isNotEmptyArray(published.diff) ? [teamsText(user.locale, 'changes'), escapeHtml(published.diff.join('\n'))] : [];
    const fresh = yield* loadView(user, tap.sessionId, {
        page: tap.page,
        notes: isNotEmptyArray(notes) ? [...notes, ...diff] : [teamsText(user.locale, 'unchanged')]
    });

    if (toMe) {
        yield* showScreen(user.chatId, messageId, { text: teamsText(user.locale, 'below'), keyboard: [] });
    }

    return yield* showTeams(user, toMe ? null : messageId, { sessionId: tap.sessionId, screen: editorScreen(user, fresh) });
});
