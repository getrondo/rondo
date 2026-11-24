import * as NodeRuntime from '@effect/platform-node/NodeRuntime';
import * as NodeServices from '@effect/platform-node/NodeServices';
import { Db } from '@rondo/db/service/db.service';
import * as Config from 'effect/Config';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';

import { readConfig } from '../ingest.effect';

import { compareGameDecisions, loadGameDecisions, parseGameDecisions } from './game-decisions';
import { compareApprovals, loadApprovals } from './load-approvals';
import { parseApprovals } from './parse-approvals';
import { readPrivateFile } from './read-private-file';

const decidedAt = Config.String('RONDO_APPROVALS_DECIDED_AT').pipe(Effect.map(value => DateTime.toDate(DateTime.makeUnsafe(value))));

const program = Effect.gen(function* () {
    const file = yield* Config.String('RONDO_APPROVALS_FILE').pipe(Effect.flatMap(path => readPrivateFile(path)));
    const config = yield* Config.String('RONDO_COMMUNITY_CONFIG').pipe(Effect.flatMap(path => readConfig(path)));
    const content = yield* Config.Literals(['links', 'games'], 'RONDO_APPROVALS_CONTENT').pipe(Config.withDefault('links' as const));
    const mode = yield* Config.Literals(['load', 'compare'], 'RONDO_APPROVALS_MODE');
    const { slug } = config;

    if (content === 'games') {
        const decisions = yield* parseGameDecisions(file);

        if (mode === 'load') {
            const loaded = yield* loadGameDecisions({ slug, decisions, decidedAt: yield* decidedAt });
            yield* Effect.logInfo('Game decisions loaded', loaded);
        }

        const compared = yield* compareGameDecisions(slug, decisions);

        return yield* Effect.logInfo('Game decisions compared', compared);
    }

    const rows = yield* parseApprovals(file, config);

    if (mode === 'load') {
        const loaded = yield* loadApprovals({ slug, rows, decidedAt: yield* decidedAt });
        yield* Effect.logInfo('Approvals loaded', loaded);
    }

    const compared = yield* compareApprovals(slug, rows);

    return yield* Effect.logInfo('Approvals compared', compared);
});

NodeRuntime.runMain(program.pipe(Effect.provide([NodeServices.layer, Db.layer])));
