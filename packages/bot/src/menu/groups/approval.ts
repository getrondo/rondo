import { isDefined } from '@rnw-community/shared';
import { recipientsOf } from '@rondo/core/access/recipients-of';
import { closeUnheard, type ApprovalRequest, type DecisionOutcome } from '@rondo/core/actions/pending-action.service';
import { accountNamesOf } from '@rondo/core/identity/telegram-user';
import { writeToChat } from '@rondo/core/telegram/write-to-chat';
import { telegramPoll } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { escapeHtml } from '@rondo/telegram/format/html';
import { and, eq, isNull } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { sendPrivate } from '../../context/private-chat';
import { buttonBudget } from '../../utils/button-budget.util';
import { fitLabel } from '../../utils/fit-label.util';
import { labelWidth } from '../../utils/label-width.util';
import { failureText } from '../failure-text';
import { menuText } from '../menu-text';
import { quotedTitles } from '../new-game/audience';

import { tellNoApprover } from './tell';

import type { Locale } from '@rondo/core/i18n/locale';

const headOf = (summary: string): string => summary.split('\n')[0] ?? '';

const yesLabel = ({ action, approver, groups }: ApprovalRequest): string => {
    const isQuiet = action._tag === 'delete_session' || ('notify' in action && !action.notify);
    const where = fitLabel(
        quotedTitles(groups, approver.locale),
        buttonBudget(1) - labelWidth(menuText(approver.locale, 'sendTo', { where: '' }))
    );

    return isQuiet ? menuText(approver.locale, 'requestYes') : menuText(approver.locale, 'sendTo', { where });
};

// The poll itself is the preview of a forward
const showPoll = Effect.fn('Bot.showPoll')(function* ({ action, approver }: ApprovalRequest) {
    const db = yield* Db;
    const [poll] =
        action._tag === 'forward_poll'
            ? yield* db
                  .select()
                  .from(telegramPoll)
                  .where(and(eq(telegramPoll.sessionId, action.sessionId), isNull(telegramPoll.closedAt)))
            : [];

    if (isDefined(poll)) {
        yield* writeToChat({
            target: { chatId: approver.tgUserId, topicId: null },
            approval: null,
            content: { _tag: 'forward', fromChatId: poll.chatId, messageId: poll.messageId }
        });
    }
});

const sendRequest = Effect.fn('Bot.sendRequest')(function* (request: ApprovalRequest) {
    const { actionId, approver, groups, requestedBy, summary } = request;
    const { locale } = approver;
    const names = yield* accountNamesOf([requestedBy]);
    const button = (text: string, answer: 'y' | 'e' | 'n') => ({ text, callback_data: `act:${actionId}:${answer}` });
    yield* showPoll(request);
    yield* sendPrivate(
        Number(approver.tgUserId),
        [
            menuText(locale, 'requestTitle', {
                name: escapeHtml(names.get(String(requestedBy)) ?? ''),
                where: escapeHtml(quotedTitles(groups, locale))
            }),
            '',
            `<blockquote>${escapeHtml(summary)}</blockquote>`,
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

export const noteOutcome = Effect.fn('Bot.noteOutcome')(function* (
    outcome: DecisionOutcome,
    { decidedBy, isEdited }: { readonly decidedBy: bigint; readonly isEdited: boolean }
) {
    if (outcome._tag === 'failed' && outcome.failure.code === 'no_approver') {
        yield* tellNoApprover;
    }

    if ((outcome._tag !== 'done' && outcome._tag !== 'failed' && outcome._tag !== 'rejected') || outcome.requestedBy === decidedBy) {
        return;
    }

    for (const { tgUserId, locale } of yield* recipientsOf([outcome.requestedBy])) {
        const rejected = menuText(locale, isEdited ? 'requestEdited' : 'requestRejected');
        const said = { done: () => menuText(locale, 'requestDone'), rejected: () => rejected, failed: () => '' };
        const words = outcome._tag === 'failed' ? failureText(locale, outcome.failure).text : said[outcome._tag]();
        yield* sendPrivate(Number(tgUserId), `${headOf(outcome.summary)}\n\n${words}`).pipe(
            Effect.catchTag('TelegramApiError', error => Effect.logWarning('[approval] requester not reached', error))
        );
    }
});
