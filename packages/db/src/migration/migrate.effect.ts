import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/effect-postgres/migrator';
import * as Effect from 'effect/Effect';

import { Db } from '../service/db.service';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export const runMigrations = Effect.fn('Db.runMigrations')(function* () {
    const db = yield* Db;
    yield* migrate(db, { migrationsFolder, migrationsSchema: 'drizzle', migrationsTable: 'migrations' });
});
