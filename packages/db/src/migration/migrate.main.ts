import * as Effect from 'effect/Effect';

import { Db } from '../service/db.service';

import { runMigrations } from './migrate.effect';

await Effect.runPromise(runMigrations().pipe(Effect.provide(Db.layer)));
