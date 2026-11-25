import { isDefined } from '@rnw-community/shared';
import { describeAction } from '@rondo/core/actions/describe-action';
import { decideAction, proposeAction } from '@rondo/core/actions/pending-action.service';
import { pendingAction } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { escapeHtml } from '@rondo/telegram/format/html';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';

import { actionContextFor } from '../context/action-context';

import { failureText, type FailureTarget } from './failure-text';
import { askApprover, noteOutcome, staysOpen } from './groups/approval';

import type { MenuUser } from './screen.interface';
import type { Action } from '@rondo/core/actions/action.model';
import type { ActionFailure } from '@rondo/core/error/action-failed.error';

type ConfirmedOutcome =
    | { readonly _tag: 'done'; readonly sessionId: string | null; readonly note: string }
    | { readonly _tag: 'asked'; readonly text: string }
    | { readonly _tag: 'failed'; readonly text: string; readonly uncertain: boolean; readonly failure: ActionFailure };

export const runConfirmed = Effect.fn('Bot.runConfirmed')(function* (
    user: MenuUser,
    action: Action,
    context: { readonly summary: string | null; readonly target: FailureTarget }
) {
    const db = yield* Db;
    const summary = context.summary ?? (yield* describeAction(action, user.locale, user.communityId));
    const actionId = yield* proposeAction({ communityId: user.communityId, tgUserId: user.tgUserId, action, summary, now: user.now });
    const outcome = yield* decideAction({
        actionId,
        tgUserId: user.tgUserId,
        confirm: true,
        context: actionContextFor,
        now: user.now
    });

    if (outcome._tag === 'done') {
        const [row] = yield* db.select({ result: pendingAction.result }).from(pendingAction).where(eq(pendingAction.id, actionId));
        const result = row?.result;
        const sessionId = Predicate.hasProperty(result, 'sessionId') && Predicate.isString(result.sessionId) ? result.sessionId : null;

        return {
            _tag: 'done',
            note: staysOpen(user.locale, escapeHtml(outcome.openIn ?? '')),
            sessionId: sessionId ?? ('sessionId' in action && isDefined(action.sessionId) ? action.sessionId : null)
        } satisfies ConfirmedOutcome;
    }

    if (outcome._tag === 'awaiting') {
        return { _tag: 'asked', text: yield* askApprover(outcome.request, user.locale) } satisfies ConfirmedOutcome;
    }

    yield* noteOutcome(outcome, { decidedBy: user.tgUserId, isEdited: false });
    const failed: ActionFailure = outcome._tag === 'failed' ? outcome.failure : { code: 'unexpected' };
    const failure: ActionFailure =
        failed.code === 'notice_missed' ? { ...failed, chats: escapeHtml(failed.chats), sent: escapeHtml(failed.sent) } : failed;
    const postsPoll = action._tag === 'announce_session' || (action._tag === 'create_session' && action.announce);
    const shown =
        failure.code === 'result_uncertain' && !postsPoll
            ? failureText(user.locale, failure)
            : failureText(user.locale, failure, { ...context.target, where: escapeHtml(context.target.where) });

    return { _tag: 'failed', ...shown, failure } satisfies ConfirmedOutcome;
});
