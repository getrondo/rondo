import { expect, layer } from '@effect/vitest';
import { isEmptyString, isNotEmptyArray } from '@rnw-community/shared';
import { personAlias } from '@rondo/db/schema/identity.schema';
import { Db } from '@rondo/db/service/db.service';
import { importMessages } from '@rondo/ingest-telegram/ingest.effect';
import { and, eq, sql } from 'drizzle-orm';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import * as Option from 'effect/Option';
import * as Schedule from 'effect/Schedule';

import { syncMember } from '../src/identity/telegram-user';
import { linkAlias, unlinkAlias } from '../src/people/alias-links.service';
import { localPostgresLayer } from '../src/testing/local-postgres.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

import type { TelegramMessage } from '@rondo/ingest-telegram/model/telegram-message.model';

const databaseUrl = process.env.RONDO_TEST_DATABASE_URL ?? '';

const days = Array.from({ length: 12 }, (_, index) => `2025-05-${String(index + 1).padStart(2, '0')}`);
const striker = 7_000_001;

const messages = days.flatMap((day, index): TelegramMessage[] => [
    {
        id: index * 10 + 1,
        kind: 'message',
        sentAt: new Date(`${day}T08:00:00Z`),
        author: 'Org',
        poll: { question: 'Сегодня футбол 19.00 North', answers: ['+', '-'] },
        media: []
    },
    {
        id: index * 10 + 2,
        kind: 'message',
        sentAt: new Date(`${day}T12:00:00Z`),
        author: 'Org',
        text: `Составы на сегодня, North:\n🟢Гонзо, Олег${index}\n🔵Семён${index}`,
        media: []
    }
]);

const importGames = (slug: string) =>
    importMessages({
        config: seedConfig(slug),
        messages,
        fileSha256: 'sha',
        snapshot: Option.some({
            users: new Map(),
            pollIdByMessage: new Map(days.map((_, index) => [index * 10 + 1, `${slug}-${index}`])),
            votes: days.map((day, index) => ({
                pollId: `${slug}-${index}`,
                userId: striker,
                choice: 'yes' as const,
                votedAt: new Date(`${day}T09:00:00Z`)
            }))
        })
    });

const waitFor = (lockType: 'advisory' | 'relation') =>
    Effect.gen(function* () {
        const db = yield* Db;
        const { rows } = yield* db.execute(sql`select 1 from pg_locks where locktype = ${lockType} and not granted`);

        return yield* isNotEmptyArray(rows) ? Effect.void : Effect.fail('nobody waits');
    }).pipe(Effect.retry({ schedule: Schedule.spaced('20 millis'), times: 250 }));

const duringImport = Effect.fn('test.duringImport')(function* <Value, Failure>(slug: string, change: Effect.Effect<Value, Failure, Db>) {
    const db = yield* Db;
    const held = yield* Deferred.make<boolean>();
    const release = yield* Deferred.make<boolean>();
    const holder = yield* Effect.forkChild(
        db.transaction(() =>
            db
                .execute(sql`lock table ingest.run in access exclusive mode`)
                .pipe(Effect.andThen(Deferred.succeed(held, true)), Effect.andThen(Deferred.await(release)))
        )
    );
    yield* Deferred.await(held);
    const importing = yield* Effect.forkChild(importGames(slug));
    yield* waitFor('relation');
    const changing = yield* Effect.forkChild(Effect.exit(change));
    const waited = yield* Effect.exit(waitFor('advisory'));
    yield* Deferred.succeed(release, true);
    yield* Fiber.join(holder);
    yield* Fiber.join(importing);

    return { waited: Exit.isSuccess(waited), change: yield* Fiber.join(changing) };
});

const aliasNamed = Effect.fn('test.aliasNamed')(function* (communityId: string, aliasNorm: string) {
    const db = yield* Db;
    const [alias] = yield* db
        .select()
        .from(personAlias)
        .where(and(eq(personAlias.communityId, communityId), eq(personAlias.aliasNorm, aliasNorm)));

    return alias;
});

layer(localPostgresLayer(databaseUrl), { timeout: 60_000, excludeTestServices: true })(
    'admin work during an import, on a real Postgres',
    it => {
        it.effect.skipIf(isEmptyString(databaseUrl))('lets an undo wait for the import and win', () =>
            Effect.gen(function* () {
                const slug = `lock-undo-${performance.now()}`;
                const { communityId } = yield* seedCommunity(seedConfig(slug));
                yield* importGames(slug);
                const linked = yield* aliasNamed(communityId, 'гонзо');
                const outcome = yield* duringImport(slug, unlinkAlias({ communityId, aliasId: linked?.id ?? '', actorPersonId: null }));
                const undone = yield* aliasNamed(communityId, 'гонзо');
                yield* importGames(slug);
                const later = yield* aliasNamed(communityId, 'гонзо');

                expect(linked?.resolution).toBe('vote');
                expect(outcome.waited).toBe(true);
                expect(Exit.isSuccess(outcome.change)).toBe(true);
                expect(undone?.resolution).toBe('guest');
                expect(later?.resolution).toBe('guest');
            })
        );

        it.effect.skipIf(isEmptyString(databaseUrl))('refuses a link to a nickname the import has just removed', () =>
            Effect.gen(function* () {
                const db = yield* Db;
                const slug = `lock-gone-${performance.now()}`;
                const { communityId } = yield* seedCommunity(seedConfig(slug));
                yield* importGames(slug);
                const personId = yield* syncMember(communityId, { id: 7_000_002n, firstName: 'Tele' }, 'active');
                const [unused] = yield* db.insert(personAlias).values({ communityId, alias: 'Лишний', aliasNorm: 'лишний' }).returning();
                const outcome = yield* duringImport(
                    slug,
                    linkAlias({ communityId, aliasId: unused?.id ?? '', personId, actorPersonId: null })
                );

                expect(outcome.waited).toBe(true);
                expect(Exit.isFailure(outcome.change)).toBe(true);
            })
        );
    }
);
