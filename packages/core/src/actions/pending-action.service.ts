import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { pendingAction } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, isNull, lt, ne, sql } from 'drizzle-orm';
import * as Cause from 'effect/Cause';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Schema from 'effect/Schema';

import { failureOf, type ActionFailure } from '../error/action-failed.error';
import { addMillis } from '../utils/add-millis.util';

import { ActionSchema, type Action } from './action.model';
import { runAdminAction, type ActionContext } from './execute-action';

const confirmationWindowMs = 30 * 60_000;
// A second tap must not report an action that is still running
const runningMs = 65_000;

export type DecisionOutcome =
    | { readonly _tag: 'missing' }
    | { readonly _tag: 'expired' }
    | { readonly _tag: 'rejected' }
    | { readonly _tag: 'done'; readonly summary: string }
    | { readonly _tag: 'failed'; readonly summary: string; readonly failure: ActionFailure };

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

const uncertain: ActionFailure = { code: 'result_uncertain' };

const reportCutOff = Effect.fn('Core.reportCutOff')(function* (actionId: string, tgUserId: bigint, now: Date) {
    const db = yield* Db;
    const [cutOff] = yield* db
        .update(pendingAction)
        .set({ status: 'failed', result: { failure: uncertain } })
        .where(
            and(
                eq(pendingAction.id, actionId),
                eq(pendingAction.requestedByTgUserId, tgUserId),
                eq(pendingAction.status, 'confirmed'),
                lt(pendingAction.decidedAt, addMillis(now, -runningMs)),
                isNull(pendingAction.result)
            )
        )
        .returning({ summary: pendingAction.summary });

    if (isDefined(cutOff)) {
        return { _tag: 'failed', summary: cutOff.summary, failure: uncertain } as const;
    }

    const [row] = yield* db
        .select({ status: pendingAction.status })
        .from(pendingAction)
        .where(and(eq(pendingAction.id, actionId), eq(pendingAction.requestedByTgUserId, tgUserId)));

    return row?.status === 'expired' ? ({ _tag: 'expired' } as const) : ({ _tag: 'missing' } as const);
});

export const decideAction = Effect.fn('Core.decideAction')(function* (input: {
    readonly actionId: string;
    readonly tgUserId: bigint;
    readonly confirm: boolean;
    readonly context: (communityId: string) => Effect.Effect<ActionContext, never, Db>;
    readonly now?: Date;
}) {
    const db = yield* Db;
    const now = input.now ?? (yield* DateTime.nowAsDate);
    const [claimed] = yield* db
        .update(pendingAction)
        .set({ status: input.confirm ? 'confirmed' : 'rejected', decidedAt: now })
        .where(
            and(
                eq(pendingAction.id, input.actionId),
                eq(pendingAction.requestedByTgUserId, input.tgUserId),
                eq(pendingAction.status, 'proposed')
            )
        )
        .returning();

    if (!isDefined(claimed)) {
        return yield* reportCutOff(input.actionId, input.tgUserId, now);
    }

    if (claimed.expiresAt < now) {
        yield* db.update(pendingAction).set({ status: 'expired' }).where(eq(pendingAction.id, claimed.id));

        return { _tag: 'expired' } as const;
    }

    if (!input.confirm) {
        return { _tag: 'rejected' } as const;
    }

    const action = yield* Schema.decodeUnknownEffect(ActionSchema)(claimed.payload).pipe(Effect.orDie);
    const context = yield* input.context(claimed.communityId);
    const exit = yield* Effect.exit(
        runAdminAction(input.tgUserId, action, context, {
            summary: claimed.summary,
            settle: result => db.update(pendingAction).set({ result }).where(eq(pendingAction.id, claimed.id))
        })
    );

    if (Exit.isSuccess(exit)) {
        return { _tag: 'done', summary: claimed.summary } as const;
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
        return { _tag: 'done', summary: claimed.summary } as const;
    }

    return { _tag: 'failed', summary: claimed.summary, failure } as const;
});

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
