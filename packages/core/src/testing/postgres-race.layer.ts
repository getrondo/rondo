import { runMigrations } from '@rondo/db/migration/migrate.effect';
import { Db } from '@rondo/db/service/db.service';
import { assertLocal } from '@rondo/ingest-telegram/rehearsal/assert-local';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schedule from 'effect/Schedule';

export const raceDatabaseUrl = process.env.RONDO_TEST_DATABASE_URL ?? '';

// Several race files start at once against one database: a migration that collides with another file's is tried again
export const postgresRaceLayer = Layer.effectDiscard(
    assertLocal(raceDatabaseUrl).pipe(
        Effect.andThen(runMigrations().pipe(Effect.retry({ times: 5, schedule: Schedule.spaced('1 second') })))
    )
).pipe(Layer.provideMerge(Db.layer), Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DATABASE_URL: raceDatabaseUrl }))));
