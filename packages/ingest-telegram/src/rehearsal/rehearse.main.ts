import * as NodeRuntime from '@effect/platform-node/NodeRuntime';
import * as NodeServices from '@effect/platform-node/NodeServices';
import { isEmptyArray } from '@rnw-community/shared';
import { assertLocal } from '@rondo/core/testing/assert-local';
import { runMigrations } from '@rondo/db/migration/migrate.effect';
import { Db } from '@rondo/db/service/db.service';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import { importSettings } from '../import-settings';
import { ingest } from '../ingest.effect';

import { takeCounts, takeCountsBeforeMigration } from './take-counts';

const rehearsal = Effect.gen(function* () {
    const settings = yield* importSettings;
    const before = yield* takeCountsBeforeMigration();
    yield* runMigrations();
    yield* ingest(settings);
    const first = yield* takeCounts();
    yield* ingest(settings);
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
