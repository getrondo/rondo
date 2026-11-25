import { isNotEmptyString } from '@rnw-community/shared';
import { recipientsOf } from '@rondo/core/access/recipients-of';
import {
    closeUnheard,
    expireStaleActions,
    takeExpiredRequests,
    type ApprovalRequest,
    type DecisionOutcome
} from '@rondo/core/actions/pending-action.service';
import { accountNamesOf } from '@rondo/core/identity/telegram-user';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';

import { sendPrivate } from '../../context/private-chat';
import { buttonBudget } from '../../utils/button-budget.util';
import { fitLabel } from '../../utils/fit-label.util';
import { labelWidth } from '../../utils/label-width.util';
import { failureText } from '../failure-text';
import { showPoll } from '../game-actions/show-confirm';
import { menuText } from '../menu-text';
import { quotedTitles } from '../new-game/audience';

import { tellNoApprover } from './tell';

import type { Locale } from '@rondo/core/i18n/locale';

// Telegram refuses a message over 4096 characters, and the words around the summary need the rest
const summaryLimit = 3500;

const headOf = (summary: string): string => summary.split('\n')[0] ?? '';

const yesLabel = ({ action, approver, groups }: ApprovalRequest): string => {
    const isQuiet = action._tag === 'delete_session' || ('notify' in action && !action.notify);
    const where = fitLabel(
        quotedTitles(groups, approver.locale),
        buttonBudget(1) - labelWidth(menuText(approver.locale, 'sendTo', { where: '' }))
    );

    return isQuiet ? menuText(approver.locale, 'requestYes') : menuText(approver.locale, 'sendTo', { where });
};

const sendRequest = Effect.fn('Bot.sendRequest')(function* (request: ApprovalRequest) {
    const { actionId, approver, groups, requestedBy, summary } = request;
    const { locale } = approver;
    const names = yield* accountNamesOf([requestedBy]);
    const button = (text: string, answer: 'y' | 'e' | 'n') => ({ text, callback_data: `act:${actionId}:${answer}` });
    yield* showPoll(approver.tgUserId, request.action);
    yield* sendPrivate(
        Number(approver.tgUserId),
        [
            menuText(locale, 'requestTitle', {
                name: escapeHtml(names.get(String(requestedBy)) ?? ''),
                where: escapeHtml(quotedTitles(groups, locale))
            }),
            '',
            `<blockquote>${escapeHtml(summary.length > summaryLimit ? `${summary.slice(0, summaryLimit)}…` : summary)}</blockquote>`,
            menuText(locale, 'requestNothing')
        ].join('\n'),
        {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            reply_markup: {
                inline_keyboard: [
                    [button(yesLabel(request), 'y')],
                    [button(menuText(locale, 'requestEdit'), 'e'), button(menuText(locale, 'requestNo'), 'n')]
                ]
            }
        }
    );
});

// The words for the one who asked, whether the approver got the request or could not be reached
export const askApprover = Effect.fn('Bot.askApprover')(function* (request: ApprovalRequest, locale: Locale) {
    const isHeard = yield* sendRequest(request).pipe(
        Effect.as(true),
        Effect.catch(error =>
            Effect.logWarning('[approval] approver not reached', error).pipe(
                Effect.as(error._tag === 'TelegramApiError' && error.isUncertain)
            )
        )
    );

    if (isHeard) {
        return menuText(locale, 'asked', { name: escapeHtml(request.approver.name) });
    }

    const failure = yield* closeUnheard(request.actionId);
    yield* tellNoApprover;

    return failureText(locale, failure).text;
});

const tellRequester = Effect.fn('Bot.tellRequester')(function* (
    { requestedBy, summary }: { readonly requestedBy: bigint; readonly summary: string },
    words: (locale: Locale) => string
) {
    for (const { tgUserId, locale } of yield* recipientsOf([requestedBy])) {
        yield* sendPrivate(Number(tgUserId), `${headOf(summary)}\n\n${words(locale)}`).pipe(
            Effect.catchTag('TelegramApiError', error => Effect.logWarning('[approval] requester not reached', error))
        );
    }
});

const tellTaken = Effect.gen(function* () {
    for (const request of yield* takeExpiredRequests()) {
        yield* tellRequester(request, locale => menuText(locale, 'requestExpired'));
    }
});

export const tellExpired = (now: Date) => expireStaleActions(now).pipe(Effect.andThen(tellTaken));

export const staysOpen = (locale: Locale, openIn: string | null): string =>
    isNotEmptyString(openIn) ? `\n${menuText(locale, 'pollStaysOpen', { where: openIn })}` : '';

export const noteOutcome = Effect.fn('Bot.noteOutcome')(function* (
    outcome: DecisionOutcome,
    { decidedBy, isEdited }: { readonly decidedBy: bigint; readonly isEdited: boolean }
) {
    if (outcome._tag === 'expired') {
        yield* tellTaken;
    }

    if (outcome._tag === 'failed' && outcome.failure.code === 'no_approver') {
        yield* tellNoApprover;
    }

    if ((outcome._tag !== 'done' && outcome._tag !== 'failed' && outcome._tag !== 'rejected') || outcome.requestedBy === decidedBy) {
        return;
    }

    yield* tellRequester(outcome, locale => {
        if (outcome._tag === 'done') {
            return `${menuText(locale, 'requestDone')}${staysOpen(locale, outcome.openIn)}`;
        }

        return outcome._tag === 'failed'
            ? failureText(locale, outcome.failure).text
            : menuText(locale, isEdited ? 'requestEdited' : 'requestRejected');
    });
});
