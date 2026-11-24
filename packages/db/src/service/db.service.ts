import * as PgClient from '@effect/sql-pg/PgClient';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import * as Config from 'effect/Config';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import { DbError } from '../error/db.error';

import type { EffectPgDatabase } from 'drizzle-orm/effect-postgres';

export type Database = EffectPgDatabase;

export class Db extends Context.Service<Db, Database>()('@rondo/db/Db') {
    static readonly layerWithoutClient = Layer.effect(Db, PgDrizzle.makeWithDefaults());

    static readonly clientLayer = PgClient.layerConfig({ url: Config.Redacted('DATABASE_URL') });

    static readonly layer = Db.layerWithoutClient.pipe(Layer.provide(Db.clientLayer));

    static query<Result, Failure>(run: (database: Database) => Effect.Effect<Result, Failure>): Effect.Effect<Result, DbError, Db> {
        return Db.use(database => run(database).pipe(Effect.mapError(cause => DbError.make({ cause }))));
    }
}
