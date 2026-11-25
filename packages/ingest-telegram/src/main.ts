import * as NodeRuntime from '@effect/platform-node/NodeRuntime';
import * as NodeServices from '@effect/platform-node/NodeServices';
import { Db } from '@rondo/db/service/db.service';
import * as Effect from 'effect/Effect';

import { importSettings } from './import-settings';
import { ingest } from './ingest.effect';

const program = Effect.gen(function* () {
    const settings = yield* importSettings;

    return yield* ingest(settings);
});

NodeRuntime.runMain(program.pipe(Effect.provide([NodeServices.layer, Db.layer])));
