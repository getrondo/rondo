import { expect, layer } from '@effect/vitest';
import { priceRule } from '@rondo/db/schema/finance.schema';
import { personAlias } from '@rondo/db/schema/identity.schema';
import { fixture } from '@rondo/db/schema/league.schema';
import { teamMember } from '@rondo/db/schema/play.schema';
import { attendance, session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { testDbLayer } from '@rondo/db/testing/test-db.layer';
import { count, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { assemblePlan } from '../src/extract/assemble-plan';
import { extractAll } from '../src/extract/extract-all';
import { loadPlan } from '../src/load/load-plan';

import { message, testConfig } from './fixture';

import type { PgTable } from 'drizzle-orm/pg-core';

const messages = [
    message(1, '2025-05-04T18:00:00Z', '', {
        text: undefined,
        poll: { question: 'Понедельник, 5 мая, 19.00 North. 18 чел', answers: ['+', '-'] }
    }),
    message(2, '2025-05-05T15:00:00Z', 'Составы на сегодня, North:\n🟢Я, Иван, Пётр вратарь\n🔵Олег, Семён, Павел\nПо 10 евро на поле'),
    message(3, '2025-05-08T18:00:00Z', '', { text: undefined, poll: { question: 'Пятница, 9 мая, 19.30 Park', answers: ['+', '-'] } }),
    message(4, '2025-05-09T10:00:00Z', 'Сегодня отмена, дождь'),
    message(5, '2025-05-12T10:00:00Z', 'TFC- Alpha 6:4')
];

const plan = assemblePlan(extractAll(messages, testConfig), '2025-06-30');

const countOf = (table: PgTable) =>
    Effect.gen(function* () {
        const db = yield* Db;
        const [row] = yield* db.select({ value: count() }).from(table);

        return row?.value ?? 0;
    });

layer(testDbLayer, { timeout: 60_000 })('loading an import plan', it => {
    it.effect('writes sessions, teams, attendance, aliases, prices and fixtures', () =>
        Effect.gen(function* () {
            const stats = yield* loadPlan(testConfig, plan, 'sha');
            const db = yield* Db;
            const cancelled = yield* db.select().from(session).where(eq(session.status, 'cancelled'));

            expect(stats).toMatchObject({ sessions: 2, teams: 2, attendances: 6, aliases: 6, priceRules: 1, fixtures: 1 });
            expect(cancelled.map(row => row.cancelReason)).toEqual(['weather']);
            expect(yield* countOf(attendance)).toBe(6);
            expect(yield* countOf(teamMember)).toBe(6);
            expect(yield* countOf(priceRule)).toBe(1);
            expect(yield* countOf(fixture)).toBe(1);
        })
    );

    it.effect('is idempotent when the same export is loaded again', () =>
        Effect.gen(function* () {
            yield* loadPlan(testConfig, plan, 'sha');

            expect(yield* countOf(session)).toBe(2);
            expect(yield* countOf(personAlias)).toBe(6);
            expect(yield* countOf(attendance)).toBe(6);
            expect(yield* countOf(fixture)).toBe(1);
        })
    );
});
