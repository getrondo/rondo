import * as NodeRuntime from '@effect/platform-node/NodeRuntime';
import * as NodeServices from '@effect/platform-node/NodeServices';
import { isEmptyArray } from '@rnw-community/shared';
import { runMigrations } from '@rondo/db/migration/migrate.effect';
import { Db } from '@rondo/db/service/db.service';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import { ingest } from '../ingest.effect';

import { assertLocal } from './assert-local';
import { takeCounts, takeCountsBeforeMigration } from './take-counts';

const rehearsal = Effect.gen(function* () {
    const exportDir = yield* Config.String('RONDO_EXPORT_DIR');
    const configPath = yield* Config.String('RONDO_COMMUNITY_CONFIG');
    const before = yield* takeCountsBeforeMigration();
    yield* runMigrations();
    yield* ingest(exportDir, configPath);
    const first = yield* takeCounts();
    yield* ingest(exportDir, configPath);
    const second = yield* takeCounts();

    for (const [name, value] of first) {
        yield* Effect.logInfo(
            `${name}: ${before.get(name) ?? 'n/a'} -> ${value}${second.get(name) === value ? '' : ` -> ${second.get(name)} CHANGED`}`
        );
    }

    const changed = [...first].filter(([name, value]) => second.get(name) !== value);
    yield* Effect.logInfo(isEmptyArray(changed) ? 'Second import changed nothing' : `Second import changed ${changed.length} counts`);
});

const guard = Layer.effectDiscard(Config.String('DATABASE_URL').pipe(Effect.flatMap(databaseUrl => assertLocal(databaseUrl))));

NodeRuntime.runMain(rehearsal.pipe(Effect.provide([NodeServices.layer, Db.layer.pipe(Layer.provide(guard))])));
