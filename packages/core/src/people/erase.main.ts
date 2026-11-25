import * as NodeRuntime from '@effect/platform-node/NodeRuntime';
import { Db } from '@rondo/db/service/db.service';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';

import { erasePerson, previewErasure } from './erase-person';

const program = Effect.gen(function* () {
    const communityId = yield* Config.String('RONDO_COMMUNITY_ID');
    const personId = yield* Config.String('RONDO_ERASE_PERSON_ID');
    const mode = yield* Config.Literals(['preview', 'erase'], 'RONDO_ERASE_MODE').pipe(Config.withDefault('preview' as const));
    const counts = yield* (mode === 'erase' ? erasePerson : previewErasure)({ communityId, personId });

    return yield* Effect.logInfo(mode === 'erase' ? 'Person erased' : 'Preview, nothing was changed', counts);
});

NodeRuntime.runMain(program.pipe(Effect.provide(Db.layer)));
