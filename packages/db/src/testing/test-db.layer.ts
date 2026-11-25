import * as PgClient from '@effect/sql-pg/PgClient';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { btree_gist as btreeGist } from '@electric-sql/pglite/contrib/btree_gist';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';

import { runMigrations } from '../migration/migrate.effect';
import { Db } from '../service/db.service';

const acquireServer = Effect.acquireRelease(
    Effect.promise(async () => {
        const db = await PGlite.create({ extensions: { btree_gist: btreeGist } });
        const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' });
        await server.start();

        return { db, server };
    }),
    ({ db, server }) =>
        Effect.promise(async () => {
            await server.stop();
            await db.close();
        })
);

const clientLayer = Layer.unwrap(
    acquireServer.pipe(
        Effect.map(({ server }) =>
            PgClient.layer({
                url: Redacted.make(`postgres://postgres@${server.getServerConn()}/postgres`),
                maxConnections: 1,
                // PGlite takes one connection: a pool that drops the idle one (test clocks jump) cannot reconnect in time
                idleTimeout: 'Infinity'
            })
        )
    )
);

export const testDbLayer = Layer.effectDiscard(runMigrations()).pipe(Layer.provideMerge(Db.layerWithoutClient), Layer.provide(clientLayer));
