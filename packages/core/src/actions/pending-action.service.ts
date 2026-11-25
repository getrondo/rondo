import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { pendingAction } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, isNull, lt, ne, sql } from 'drizzle-orm';
import * as Cause from 'effect/Cause';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { approverOf } from '../community/group-settings';
import { failureOf, type ActionFailure } from '../error/action-failed.error';
import { findSameGame } from '../sessions/session.service';
import { addMillis } from '../utils/add-millis.util';

import { ActionSchema, type Action } from './action.model';
import { kickoffOf, runAdminAction, type ActionContext } from './execute-action';
import { groupsTouched } from './groups-touched';

import type { Locale } from '../i18n/locale';

export interface ApprovalRequest {
    readonly actionId: string;
    readonly communityId: string;
    readonly requestedBy: bigint;
    readonly groups: readonly string[];
    readonly action: Action;
    readonly summary: string;
    readonly approver: { readonly tgUserId: bigint; readonly name: string; readonly locale: Locale };
}

const decodeAction = Schema.decodeUnknownOption(ActionSchema);
const confirmationWindowMs = 30 * 60_000;
// A second tap must not report an action that is still running
const runningMs = 65_000;

export type DecisionOutcome =
    | { readonly _tag: 'missing' }
    | { readonly _tag: 'expired' }
    | { readonly _tag: 'awaiting'; readonly request: ApprovalRequest }
    | { readonly _tag: 'rejected'; readonly summary: string; readonly requestedBy: bigint; readonly action: Action | null }
    | { readonly _tag: 'done'; readonly summary: string; readonly requestedBy: bigint }
    | { readonly _tag: 'failed'; readonly summary: string; readonly requestedBy: bigint; readonly failure: ActionFailure };

export const proposeAction = Effect.fn('Core.proposeAction')(function* (input: {
    readonly communityId: string;
    readonly tgUserId: bigint;
    readonly action: Action;
    readonly summary: string;
    readonly now?: Date;
}) {
    const db = yield* Db;
    const now = input.now ?? (yield* DateTime.nowAsDate);
    const payload = yield* Schema.encodeEffect(ActionSchema)(input.action).pipe(Effect.orDie);
    const [row] = yield* db
        .insert(pendingAction)
        .values({
            communityId: input.communityId,
            requestedByTgUserId: input.tgUserId,
            kind: input.action._tag,
            payload,
            summary: input.summary,
            expiresAt: addMillis(now, confirmationWindowMs)
        })
        .returning({ id: pendingAction.id });

    return row?.id ?? '';
});

// The approver decides a request that was passed on to them, and the requester no longer
const decidedBy = (tgUserId: bigint) =>
    sql`coalesce(${pendingAction.approverTgUserId}, ${pendingAction.requestedByTgUserId}) = ${tgUserId}`;

const uncertain: ActionFailure = { code: 'result_uncertain' };

const reportCutOff = Effect.fn('Core.reportCutOff')(function* (actionId: string, tgUserId: bigint, now: Date) {
    const db = yield* Db;
    const [cutOff] = yield* db
        .update(pendingAction)
        .set({ status: 'failed', result: { failure: uncertain } })
        .where(
            and(
                eq(pendingAction.id, actionId),
                decidedBy(tgUserId),
                eq(pendingAction.status, 'confirmed'),
                lt(pendingAction.decidedAt, addMillis(now, -runningMs)),
                isNull(pendingAction.result)
            )
        )
        .returning({ summary: pendingAction.summary, requestedBy: pendingAction.requestedByTgUserId });

    if (isDefined(cutOff)) {
        return { _tag: 'failed', ...cutOff, failure: uncertain } as const;
    }

    const [row] = yield* db
        .select({ status: pendingAction.status })
        .from(pendingAction)
        .where(and(eq(pendingAction.id, actionId), decidedBy(tgUserId)));

    return row?.status === 'expired' ? ({ _tag: 'expired' } as const) : ({ _tag: 'missing' } as const);
});

const failProposal = Effect.fn('Core.failProposal')(function* (actionId: string, failure: ActionFailure) {
    const db = yield* Db;
    yield* db
        .update(pendingAction)
        .set({ status: 'failed', result: { failure } })
        .where(and(eq(pendingAction.id, actionId), eq(pendingAction.status, 'proposed')));

    return failure;
});

// A write to a group is decided by the approver alone, whoever prepared it
const passOn = Effect.fn('Core.passOn')(function* (proposed: typeof pendingAction.$inferSelect, action: Action, context: ActionContext) {
    const groups = isDefined(proposed.approverTgUserId) ? [] : yield* groupsTouched(action, context);

    if (!isNotEmptyArray(groups)) {
        return null;
    }

    const db = yield* Db;
    const { id, summary, requestedByTgUserId: requestedBy } = proposed;
    const refuse = (failure: ActionFailure) =>
        failProposal(id, failure).pipe(Effect.as({ _tag: 'failed', summary, requestedBy, failure } as const));
    const approver = yield* approverOf(proposed.communityId).pipe(Effect.map(found => Option.getOrNull(found)));

    if (!isDefined(approver)) {
        return yield* refuse({ code: 'no_approver' });
    }

    if (approver.tgUserIds.includes(requestedBy)) {
        return null;
    }

    const existing = action._tag === 'create_session' ? yield* findSameGame({ ...action, ...context }) : Option.none();

    if (Option.isSome(existing)) {
        return yield* refuse({ code: 'game_exists', sessionId: existing.value });
    }

    const kickoff = yield* kickoffOf(action, context).pipe(Effect.orElseSucceed(() => null));
    const passed = yield* db
        .update(pendingAction)
        .set({ approverTgUserId: approver.tgUserId, expiresAt: kickoff ?? proposed.expiresAt })
        .where(and(eq(pendingAction.id, id), eq(pendingAction.status, 'proposed'), isNull(pendingAction.approverTgUserId)))
        .returning({ id: pendingAction.id });

    return isNotEmptyArray(passed)
        ? ({
              _tag: 'awaiting',
              request: { actionId: id, communityId: proposed.communityId, action, summary, requestedBy, groups, approver }
          } as const)
        : ({ _tag: 'missing' } as const);
});

export const decideAction = Effect.fn('Core.decideAction')(function* (input: {
    readonly actionId: string;
    readonly tgUserId: bigint;
    readonly confirm: boolean;
    readonly context: (communityId: string, requester: bigint) => Effect.Effect<ActionContext, never, Db>;
    readonly now?: Date;
}) {
    const db = yield* Db;
    const now = input.now ?? (yield* DateTime.nowAsDate);
    const open = and(eq(pendingAction.id, input.actionId), decidedBy(input.tgUserId), eq(pendingAction.status, 'proposed'));
    const [proposed] = yield* db.select().from(pendingAction).where(open);
    const action = decodeAction(proposed?.payload);

    if (input.confirm && isDefined(proposed) && proposed.expiresAt >= now && Option.isSome(action)) {
        const context = yield* input.context(proposed.communityId, proposed.requestedByTgUserId);
        const passed = yield* passOn(proposed, action.value, context);

        if (isDefined(passed)) {
            return passed;
        }
    }

    const decision = Option.isSome(action) ? ('confirmed' as const) : ('failed' as const);
    const [claimed] = yield* db
        .update(pendingAction)
        .set({ status: input.confirm ? decision : 'rejected', decidedAt: now })
        .where(open)
        .returning();

    if (!isDefined(claimed)) {
        return yield* reportCutOff(input.actionId, input.tgUserId, now);
    }

    const { requestedByTgUserId: requestedBy } = claimed;

    if (claimed.expiresAt < now) {
        yield* db.update(pendingAction).set({ status: 'expired' }).where(eq(pendingAction.id, claimed.id));

        return { _tag: 'expired' } as const;
    }

    if (!input.confirm) {
        return { _tag: 'rejected', summary: claimed.summary, requestedBy, action: Option.getOrNull(action) } as const;
    }

    if (Option.isNone(action)) {
        const failure: ActionFailure = { code: 'unexpected' };
        yield* Effect.logError('[action] payload not readable', { kind: claimed.kind });
        yield* db.update(pendingAction).set({ result: { failure } }).where(eq(pendingAction.id, claimed.id));

        return { _tag: 'failed', summary: claimed.summary, requestedBy, failure } as const;
    }

    const context = yield* input.context(claimed.communityId, requestedBy);
    const exit = yield* Effect.exit(
        runAdminAction(requestedBy, action.value, context, {
            actionId: claimed.id,
            approval: { _tag: 'approver', tgUserId: input.tgUserId },
            summary: claimed.summary,
            settle: result => db.update(pendingAction).set({ result }).where(eq(pendingAction.id, claimed.id))
        })
    );

    if (Exit.isSuccess(exit)) {
        return { _tag: 'done', summary: claimed.summary, requestedBy } as const;
    }

    const failure = failureOf(Cause.squash(exit.cause));
    yield* Effect.logError('[action] failed', exit.cause);
    const failed = yield* db
        .update(pendingAction)
        .set({ status: 'failed', result: { failure } })
        .where(and(eq(pendingAction.id, claimed.id), isNull(pendingAction.result)))
        .returning({ id: pendingAction.id });

    // The result is written by a commit whose answer was lost
    if (!isNotEmptyArray(failed)) {
        return { _tag: 'done', summary: claimed.summary, requestedBy } as const;
    }

    return { _tag: 'failed', summary: claimed.summary, requestedBy, failure } as const;
});

// A request that never reached the approver is closed, so nothing waits for an answer that cannot come
export const closeUnheard = (actionId: string) => failProposal(actionId, { code: 'approver_unreachable' });

export const expireStaleActions = Effect.fn('Core.expireStaleActions')(function* (now: Date) {
    const db = yield* Db;

    yield* db
        .update(pendingAction)
        .set({ status: 'expired' })
        .where(and(eq(pendingAction.status, 'proposed'), lt(pendingAction.expiresAt, now)));
});

export const removeActionTexts = Effect.fn('Core.removeActionTexts')(function* (createdBefore: Date) {
    const db = yield* Db;
    const kept = sql`(
        select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
        from jsonb_each(${pendingAction.payload})
        where key in ('_tag', 'chatId', 'topicId', 'sessionId')
    )`;

    yield* db
        .update(pendingAction)
        .set({ summary: '', payload: kept })
        .where(and(ne(pendingAction.status, 'proposed'), ne(pendingAction.summary, ''), lt(pendingAction.createdAt, createdBefore)));
});
