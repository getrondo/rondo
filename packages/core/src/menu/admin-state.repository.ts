import { isDefined } from '@rnw-community/shared';
import { adminState } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, gt, isNotNull, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { addMillis } from '../utils/add-millis.util';

import type { AdminStateInput, AdminStateRow } from './admin-state.interface';

const lifetimeMs = 30 * 60_000;

export const saveAdminState = Effect.fn('Core.saveAdminState')(function* (input: AdminStateInput) {
    const db = yield* Db;
    const values = {
        communityId: input.communityId,
        messageId: input.messageId,
        awaiting: input.awaiting,
        draft: input.draft ?? {},
        expiresAt: addMillis(input.now, lifetimeMs)
    };
    const [row] = yield* db
        .insert(adminState)
        .values({ tgUserId: input.tgUserId, revision: 1, ...values })
        .onConflictDoUpdate({ target: adminState.tgUserId, set: { ...values, revision: sql`${adminState.revision} + 1` } })
        .returning();

    return row ?? { tgUserId: input.tgUserId, revision: 0, ...values };
});

export const loadAdminState = Effect.fn('Core.loadAdminState')(function* (tgUserId: bigint, now: Date) {
    const db = yield* Db;
    const [row] = yield* db
        .select()
        .from(adminState)
        .where(and(eq(adminState.tgUserId, tgUserId), gt(adminState.expiresAt, now)));

    return Option.fromNullishOr(row).pipe(Option.map((found): AdminStateRow => found));
});

export const takeAwaiting = Effect.fn('Core.takeAwaiting')(function* (tgUserId: bigint, now: Date) {
    const db = yield* Db;
    const live = yield* loadAdminState(tgUserId, now);

    if (Option.isNone(live) || !isDefined(live.value.awaiting)) {
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
        .delete(adminState)
        .where(and(eq(adminState.tgUserId, tgUserId), eq(adminState.revision, revision), gt(adminState.expiresAt, now)))
        .returning();

    return Option.fromNullishOr(row).pipe(Option.map((found): AdminStateRow => found));
});

export const restoreAdminState = Effect.fn('Core.restoreAdminState')(function* (row: AdminStateRow, now: Date) {
    const db = yield* Db;

    yield* db
        .insert(adminState)
        .values({ ...row, awaiting: null, revision: row.revision + 1, expiresAt: addMillis(now, lifetimeMs) })
        .onConflictDoNothing();
});

export const clearAdminState = Effect.fn('Core.clearAdminState')(function* (tgUserId: bigint) {
    const db = yield* Db;

    yield* db.delete(adminState).where(eq(adminState.tgUserId, tgUserId));
});
