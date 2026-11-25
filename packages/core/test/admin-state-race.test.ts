import { expect, layer } from '@effect/vitest';
import { isEmptyString } from '@rnw-community/shared';
import { runMigrations } from '@rondo/db/migration/migrate.effect';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { assertLocal } from '@rondo/ingest-telegram/rehearsal/assert-local';
import { makeRecorder, recordingTelegramLayer } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';

import { Access } from '../src/access/admin-access';
import { describeAction } from '../src/actions/describe-action';
import { decideAction, proposeAction } from '../src/actions/pending-action.service';
import { consumeAdminState, saveAdminState, takeAwaiting } from '../src/menu/admin-state.repository';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

import type { Action } from '../src/actions/action.model';

const databaseUrl = process.env.RONDO_TEST_DATABASE_URL ?? '';
const now = new Date('2026-11-25T08:00:00Z');
const racers = 8;

const postgresLayer = Layer.mergeAll(
    Layer.effectDiscard(assertLocal(databaseUrl).pipe(Effect.andThen(runMigrations()))).pipe(Layer.provideMerge(Db.layer)),
    recordingTelegramLayer(makeRecorder()),
    Access.layerFor([42n])
).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DATABASE_URL: databaseUrl }))));

layer(postgresLayer, { timeout: 60_000, excludeTestServices: true })('admin state races on a real Postgres', it => {
    it.effect.skipIf(isEmptyString(databaseUrl))('hands typed input and a confirmation to exactly one of many racers', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedCommunity(seedConfig(`race-state-${performance.now()}`));
            const tgUserId = BigInt(Math.floor(performance.now()));
            const saved = yield* saveAdminState({ tgUserId, communityId, messageId: 1, awaiting: 'time', draft: {}, now });
            const typed = yield* Effect.all(
                Array.from({ length: racers }, () => takeAwaiting(tgUserId, saved.revision, now)),
                { concurrency: 'unbounded' }
            );
            const live = yield* saveAdminState({ tgUserId, communityId, messageId: 1, awaiting: null, draft: {}, now });
            const confirmed = yield* Effect.all(
                Array.from({ length: racers }, () => consumeAdminState(tgUserId, live.revision, now)),
                { concurrency: 'unbounded' }
            );

            expect(typed.filter(entry => Option.isSome(entry))).toHaveLength(1);
            expect(confirmed.filter(entry => Option.isSome(entry))).toHaveLength(1);
        })
    );

    it.effect.skipIf(isEmptyString(databaseUrl))('creates one game when ✅ is tapped many times at once', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig(`race-ok-${performance.now()}`));
            const action: Action = {
                _tag: 'create_session',
                localDate: '2026-12-04',
                localTime: '19:00',
                venueId: null,
                capacityMax: 14,
                title: null,
                announce: false
            };
            const summary = yield* describeAction(action, 'uk', communityId);
            const actionId = yield* proposeAction({ communityId, tgUserId: 42n, action, summary, now });
            const context = (id: string) =>
                Effect.succeed({
                    communityId: id,
                    timezone: 'Europe/Vienna',
                    group: Option.none(),
                    groupLocale: 'uk' as const,
                    actorPersonId: null
                });
            const outcomes = yield* Effect.all(
                Array.from({ length: racers }, () => decideAction({ actionId, tgUserId: 42n, confirm: true, context, now })),
                { concurrency: 'unbounded' }
            );
            const games = yield* db.select().from(session).where(eq(session.communityId, communityId));

            expect(outcomes.filter(outcome => outcome._tag === 'done')).toHaveLength(1);
            expect(games).toHaveLength(1);
        })
    );
});
