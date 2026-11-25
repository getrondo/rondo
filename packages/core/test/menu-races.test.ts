import { expect, layer } from '@effect/vitest';
import { isEmptyString } from '@rnw-community/shared';
import { runMigrations } from '@rondo/db/migration/migrate.effect';
import { telegramPoll } from '@rondo/db/schema/platform.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { assertLocal } from '@rondo/ingest-telegram/rehearsal/assert-local';
import { makeRecorder, recordingTelegramLayer } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';

import { Access } from '../src/access/admin-access';
import { decideAction, proposeAction } from '../src/actions/pending-action.service';
import { deleteSession } from '../src/sessions/delete-session';
import { createSession } from '../src/sessions/session.service';
import { applyPollAnswer } from '../src/signups/signup.service';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

import type { Action } from '../src/actions/action.model';

const databaseUrl = process.env.RONDO_TEST_DATABASE_URL ?? '';
const rounds = 12;
const now = new Date('2026-11-25T08:00:00Z');
const withoutPostgres = isEmptyString(databaseUrl);

const postgresLayer = Layer.mergeAll(
    Layer.effectDiscard(assertLocal(databaseUrl).pipe(Effect.andThen(runMigrations()))).pipe(Layer.provideMerge(Db.layer)),
    recordingTelegramLayer(makeRecorder()),
    Access.layerFor([42n])
).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DATABASE_URL: databaseUrl }))));

const unique = () => `${Math.floor(performance.now() * 1000)}-${Math.random().toString(36).slice(2, 8)}`;

layer(postgresLayer, { timeout: 120_000, excludeTestServices: true })('menu races on a real Postgres', it => {
    it.effect.skipIf(withoutPostgres)('never deletes a game whose player vote was counted at the same time', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig(`race-delete-${unique()}`));
            const base = { communityId, timezone: 'Europe/Vienna', title: null, actorPersonId: null, venueId: null, capacityMax: 14 };
            const outcomes = yield* Effect.all(
                Array.from({ length: rounds }, (_, round) =>
                    Effect.gen(function* () {
                        const sessionId = yield* createSession({ ...base, localDate: '2030-12-04', localTime: `1${round % 10}:00` });
                        const pollId = `race-delete-${unique()}-${round}`;
                        yield* db
                            .insert(telegramPoll)
                            .values({ pollId, chatId: -1n, messageId: round + 1, sessionId, options: ['in', 'out'] });
                        const [voted, deleted] = yield* Effect.all(
                            [
                                applyPollAnswer({ pollId, user: { id: BigInt(9_100_000 + round), firstName: 'Player' }, optionIds: [0] }),
                                deleteSession({ communityId, sessionId, today: '2030-01-01', actorPersonId: null }).pipe(Effect.exit)
                            ],
                            { concurrency: 'unbounded' }
                        );
                        const kept = yield* db.select({ id: session.id }).from(session).where(eq(session.id, sessionId));
                        const signups = yield* db.select({ id: signup.id }).from(signup).where(eq(signup.sessionId, sessionId));

                        return {
                            counted: Option.isSome(voted),
                            deleted: deleted._tag === 'Success',
                            kept: kept.length,
                            signups: signups.length
                        };
                    })
                ),
                { concurrency: 'unbounded' }
            );

            expect(outcomes.filter(outcome => outcome.counted && outcome.deleted)).toEqual([]);
            expect(outcomes.filter(outcome => outcome.deleted && outcome.kept > 0)).toEqual([]);
            expect(outcomes.filter(outcome => outcome.counted && outcome.signups !== 1)).toEqual([]);
        })
    );

    it.effect.skipIf(withoutPostgres)('creates one game when two admins confirm the same game at once', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig(`race-same-${unique()}`));
            const action: Action = {
                _tag: 'create_session',
                localDate: '2030-12-06',
                localTime: '19:00',
                venueId: null,
                capacityMax: 14,
                title: null,
                announce: false
            };
            const context = (id: string) =>
                Effect.succeed({
                    communityId: id,
                    timezone: 'Europe/Vienna',
                    group: Option.none(),
                    groupLocale: 'uk' as const,
                    actorPersonId: null
                });
            const actionIds = yield* Effect.all(
                Array.from({ length: 6 }, () => proposeAction({ communityId, tgUserId: 42n, action, summary: 'same game', now })),
                { concurrency: 1 }
            );
            const outcomes = yield* Effect.all(
                actionIds.map(actionId => decideAction({ actionId, tgUserId: 42n, confirm: true, context, now })),
                { concurrency: 'unbounded' }
            );
            const games = yield* db.select().from(session).where(eq(session.communityId, communityId));

            expect(games).toHaveLength(1);
            expect(outcomes.filter(outcome => outcome._tag === 'done')).toHaveLength(1);
            expect(
                outcomes.filter(outcome => outcome._tag === 'failed' && outcome.reason.startsWith('the game already exists'))
            ).toHaveLength(5);
        })
    );
});
