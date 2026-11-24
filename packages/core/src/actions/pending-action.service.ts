import { isDefined } from '@rnw-community/shared';
import { pendingAction } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, lt } from 'drizzle-orm';
import * as Cause from 'effect/Cause';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Schema from 'effect/Schema';

import { addMillis } from '../utils/add-millis.util';

import { ActionSchema, type Action } from './action.model';
import { executeAction, type ActionContext } from './execute-action';

const confirmationWindowMs = 30 * 60_000;

export type DecisionOutcome =
    | { readonly _tag: 'missing' }
    | { readonly _tag: 'expired' }
    | { readonly _tag: 'rejected' }
    | { readonly _tag: 'done'; readonly summary: string }
    | { readonly _tag: 'failed'; readonly summary: string; readonly reason: string };

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
        return { _tag: 'missing' } as const;
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
    const exit = yield* Effect.exit(executeAction(action, context));

    if (Exit.isSuccess(exit)) {
        yield* db.update(pendingAction).set({ result: exit.value }).where(eq(pendingAction.id, claimed.id));

        return { _tag: 'done', summary: claimed.summary } as const;
    }

    const reason = Cause.pretty(exit.cause).split('\n')[0] ?? 'error';
    yield* db.update(pendingAction).set({ status: 'failed', result: { reason } }).where(eq(pendingAction.id, claimed.id));

    return { _tag: 'failed', summary: claimed.summary, reason } as const;
});

export const expireStaleActions = Effect.fn('Core.expireStaleActions')(function* (now: Date) {
    const db = yield* Db;

    yield* db
        .update(pendingAction)
        .set({ status: 'expired' })
        .where(and(eq(pendingAction.status, 'proposed'), lt(pendingAction.expiresAt, now)));
});
