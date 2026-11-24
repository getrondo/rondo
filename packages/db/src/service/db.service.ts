import * as PgClient from '@effect/sql-pg/PgClient';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import * as Config from 'effect/Config';
import * as Context from 'effect/Context';
import * as Layer from 'effect/Layer';

import type { EffectPgDatabase } from 'drizzle-orm/effect-postgres';

export type Database = EffectPgDatabase;

export class Db extends Context.Service<Db, Database>()('@rondo/db/Db') {
    static readonly layerWithoutClient = Layer.effect(Db, PgDrizzle.makeWithDefaults());

    static readonly clientLayer = PgClient.layerConfig({ url: Config.Redacted('DATABASE_URL') });

    static readonly layer = Db.layerWithoutClient.pipe(Layer.provide(Db.clientLayer));
}
