import { isDefined } from '@rnw-community/shared';
import { adminState } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { addMillis } from '../utils/add-millis.util';

import type { AdminStateInput, AdminStateRow } from './admin-state.interface';

const lifetimeMs = 30 * 60_000;
// Rows are never deleted, so a revision is never handed out twice
const gone = new Date(0);
const nextRevision = sql`${adminState.revision} + 1`;

const valuesOf = (input: AdminStateInput) => ({
    communityId: input.communityId,
    messageId: input.messageId,
    awaiting: input.awaiting,
    draft: input.draft ?? {},
    expiresAt: addMillis(input.now, lifetimeMs)
});

export const saveAdminState = Effect.fn('Core.saveAdminState')(function* (input: AdminStateInput) {
    const db = yield* Db;
    const values = valuesOf(input);
    const [row] = yield* db
        .insert(adminState)
        .values({ tgUserId: input.tgUserId, revision: 1, ...values })
        .onConflictDoUpdate({ target: adminState.tgUserId, set: { ...values, revision: nextRevision } })
        .returning();

    return row ?? { tgUserId: input.tgUserId, revision: 0, ...values };
});

export const replaceAdminState = Effect.fn('Core.replaceAdminState')(function* (input: AdminStateInput, expected: number) {
    const db = yield* Db;
    const [row] = yield* db
        .update(adminState)
        .set({ ...valuesOf(input), revision: nextRevision })
        .where(and(eq(adminState.tgUserId, input.tgUserId), eq(adminState.revision, expected)))
        .returning();

    return Option.fromNullishOr(row).pipe(Option.map((found): AdminStateRow => found));
});

export const loadAdminState = Effect.fn('Core.loadAdminState')(function* (tgUserId: bigint, now: Date) {
    const db = yield* Db;
    const [row] = yield* db
        .select()
        .from(adminState)
        .where(and(eq(adminState.tgUserId, tgUserId), gt(adminState.expiresAt, now)));

    return Option.fromNullishOr(row).pipe(Option.map((found): AdminStateRow => found));
});

export const takeAwaiting = Effect.fn('Core.takeAwaiting')(function* (tgUserId: bigint, revision: number, now: Date) {
    const db = yield* Db;
    const live = yield* loadAdminState(tgUserId, now);

    if (Option.isNone(live) || !isDefined(live.value.awaiting) || live.value.revision !== revision) {
        return Option.none<AdminStateRow>();
    }

    const [taken] = yield* db
        .update(adminState)
        .set({ awaiting: null, revision: live.value.revision + 1, expiresAt: addMillis(now, lifetimeMs) })
        .where(and(eq(adminState.tgUserId, tgUserId), eq(adminState.revision, live.value.revision), isNotNull(adminState.awaiting)))
        .returning();

    return Option.fromNullishOr(taken).pipe(Option.map((row): AdminStateRow => ({ ...row, awaiting: live.value.awaiting })));
});

export const consumeAdminState = Effect.fn('Core.consumeAdminState')(function* (tgUserId: bigint, revision: number, now: Date) {
    const db = yield* Db;
    const [row] = yield* db
        .update(adminState)
        .set({ awaiting: null, expiresAt: gone, revision: nextRevision })
        .where(and(eq(adminState.tgUserId, tgUserId), eq(adminState.revision, revision), gt(adminState.expiresAt, now)))
        .returning();

    return Option.fromNullishOr(row).pipe(Option.map((found): AdminStateRow => found));
});

export const moveAdminMessage = Effect.fn('Core.moveAdminMessage')(function* (tgUserId: bigint, messageId: number, revision: number) {
    const db = yield* Db;

    yield* db
        .update(adminState)
        .set({ messageId })
        .where(and(eq(adminState.tgUserId, tgUserId), eq(adminState.revision, revision)));
});

// With a message, only a draft on that message (or on none, or an expired one) is cleared
export const clearAdminState = Effect.fn('Core.clearAdminState')(function* (
    tgUserId: bigint,
    scope?: { readonly messageId: number; readonly now: Date }
) {
    const db = yield* Db;
    const onMessage = isDefined(scope)
        ? [or(isNull(adminState.messageId), eq(adminState.messageId, scope.messageId), lte(adminState.expiresAt, scope.now))]
        : [];

    yield* db
        .update(adminState)
        .set({ awaiting: null, draft: {}, messageId: null, expiresAt: gone, revision: nextRevision })
        .where(and(eq(adminState.tgUserId, tgUserId), ...onMessage));
});
