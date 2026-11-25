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

import type { MenuUser } from './screen.interface';
import type { Action } from '@rondo/core/actions/action.model';

type ConfirmedOutcome =
    | { readonly _tag: 'done'; readonly sessionId: string | null }
    | { readonly _tag: 'failed'; readonly text: string; readonly uncertain: boolean; readonly reason: string };

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
        context: actionContextFor(user.tgUserId),
        now: user.now
    });

    if (outcome._tag === 'done') {
        const [row] = yield* db.select({ result: pendingAction.result }).from(pendingAction).where(eq(pendingAction.id, actionId));
        const result = row?.result;
        const sessionId = Predicate.hasProperty(result, 'sessionId') && Predicate.isString(result.sessionId) ? result.sessionId : null;

        return {
            _tag: 'done',
            sessionId: sessionId ?? ('sessionId' in action && isDefined(action.sessionId) ? action.sessionId : null)
        } satisfies ConfirmedOutcome;
    }

    const reason = outcome._tag === 'failed' ? outcome.reason : outcome._tag;
    const failure = failureText(user.locale, reason, { ...context.target, where: escapeHtml(context.target.where) });

    return { _tag: 'failed', ...failure, reason } satisfies ConfirmedOutcome;
});
