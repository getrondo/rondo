// Test files run in parallel against one database, so its migrations take turns
import { runMigrations } from '@rondo/db/migration/migrate.effect';
import { Db } from '@rondo/db/service/db.service';
import { assertLocal } from '@rondo/ingest-telegram/rehearsal/assert-local';
import { sql } from 'drizzle-orm';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

const migrateInTurn = Effect.gen(function* () {
    const db = yield* Db;

    yield* db.transaction(() =>
        Effect.gen(function* () {
            yield* db.execute(sql`select pg_advisory_xact_lock(hashtext('rondo test migrations'))`);
            yield* runMigrations();
        })
    );
});

export const localPostgresLayer = (databaseUrl: string) =>
    Layer.effectDiscard(assertLocal(databaseUrl).pipe(Effect.andThen(migrateInTurn))).pipe(
        Layer.provideMerge(Db.layer),
        Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DATABASE_URL: databaseUrl })))
    );
