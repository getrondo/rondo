import * as NodeRuntime from '@effect/platform-node/NodeRuntime';
import * as NodeServices from '@effect/platform-node/NodeServices';
import { Db } from '@rondo/db/service/db.service';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';

import { ingest } from './ingest.effect';

const program = Effect.gen(function* () {
    const exportDir = yield* Config.String('RONDO_EXPORT_DIR');
    const configPath = yield* Config.String('RONDO_COMMUNITY_CONFIG');

    return yield* ingest(exportDir, configPath);
});

NodeRuntime.runMain(program.pipe(Effect.provide([NodeServices.layer, Db.layer])));
