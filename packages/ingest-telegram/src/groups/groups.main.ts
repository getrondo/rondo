import * as NodeRuntime from '@effect/platform-node/NodeRuntime';
import * as NodeServices from '@effect/platform-node/NodeServices';
import { GroupsFileSchema, loadGroups } from '@rondo/core/community/group-settings';
import { Db } from '@rondo/db/service/db.service';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

import { readPrivateFile } from '../approvals/read-private-file';

const program = Effect.gen(function* () {
    const path = yield* Config.String('RONDO_GROUPS_FILE');
    const file = yield* readPrivateFile(path);
    const groups = yield* Schema.decodeEffect(Schema.fromJsonString(GroupsFileSchema))(file);
    const loaded = yield* loadGroups(groups);

    yield* Effect.logInfo('Groups loaded', loaded);
});

NodeRuntime.runMain(program.pipe(Effect.provide([NodeServices.layer, Db.layer])));
