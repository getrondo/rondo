import { assistantMessage } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { desc, eq } from 'drizzle-orm';
import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';

import type { ModelMessage } from 'ai';

const historyTurns = 12;

export const loadHistory = Effect.fn('Assistant.loadHistory')(function* (tgUserId: bigint) {
    const db = yield* Db;
    const rows = yield* db
        .select({ role: assistantMessage.role, content: assistantMessage.content, at: assistantMessage.at })
        .from(assistantMessage)
        .where(eq(assistantMessage.tgUserId, tgUserId))
        .orderBy(desc(assistantMessage.at))
        .limit(historyTurns);

    return rows
        .toSorted((left, right) => left.at.getTime() - right.at.getTime())
        .map((row): ModelMessage => ({ role: row.role, content: row.content }));
});

export const appendHistory = Effect.fn('Assistant.appendHistory')(function* (
    tgUserId: bigint,
    turns: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[]
) {
    const db = yield* Db;
    const base = yield* Clock.currentTimeMillis;

    yield* db
        .insert(assistantMessage)
        .values(turns.map((turn, index) => ({ tgUserId, role: turn.role, content: turn.content, at: new Date(base + index) })));
});

export const clearHistory = Effect.fn('Assistant.clearHistory')(function* (tgUserId: bigint) {
    const db = yield* Db;

    yield* db.delete(assistantMessage).where(eq(assistantMessage.tgUserId, tgUserId));
});
