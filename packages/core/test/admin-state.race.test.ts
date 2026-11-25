import { expect, layer } from '@effect/vitest';
import { isDefined, isEmptyString } from '@rnw-community/shared';
import { pendingAction, pollForward, telegramPoll } from '@rondo/db/schema/platform.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder, recordingTelegramLayer } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Predicate from 'effect/Predicate';

import { Access } from '../src/access/admin-access';
import { describeAction } from '../src/actions/describe-action';
import { decideAction, proposeAction } from '../src/actions/pending-action.service';
import { clearAdminState, consumeAdminState, replaceAdminState, saveAdminState, takeAwaiting } from '../src/menu/admin-state.repository';
import { deleteSession } from '../src/sessions/delete-session';
import { createSession } from '../src/sessions/session.service';
import { forwardPoll } from '../src/signups/forward-poll';
import { applyPollAnswer } from '../src/signups/signup.service';
import { linkGroup, ownerApproval } from '../src/testing/link-group';
import { localPostgresLayer, raceDatabaseUrl } from '../src/testing/local-postgres.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

import type { Action } from '../src/actions/action.model';

const now = new Date('2026-11-25T08:00:00Z');
const racers = 8;
const rounds = 12;
const retryToken = '00000000-0000-4000-8000-000000000003';
const withoutPostgres = isEmptyString(raceDatabaseUrl);
const raceRecorder = makeRecorder();
const withoutGroup = (id: string) =>
    Effect.succeed({ communityId: id, timezone: 'Europe/Vienna', group: Option.none(), groupLocale: 'uk' as const, actorPersonId: null });
const confirmAll = (actionIds: readonly string[]) =>
    Effect.all(
        actionIds.map(actionId => decideAction({ actionId, tgUserId: 42n, confirm: true, context: withoutGroup, now })),
        { concurrency: 'unbounded' }
    );
const menuGame = Effect.fn('test.menuGame')(function* (communityId: string, localTime: string) {
    const db = yield* Db;
    const action: Action = {
        _tag: 'create_session',
        localDate: '2030-12-04',
        localTime,
        venueId: null,
        capacityMax: 14,
        title: null,
        announce: false
    };
    const actionId = yield* proposeAction({ communityId, tgUserId: 42n, action, summary: 'menu game', now });
    yield* decideAction({ actionId, tgUserId: 42n, confirm: true, context: withoutGroup, now });
    const [row] = yield* db.select({ result: pendingAction.result }).from(pendingAction).where(eq(pendingAction.id, actionId));

    return Predicate.hasProperty(row?.result, 'sessionId') && Predicate.isString(row.result.sessionId) ? row.result.sessionId : '';
});
const forwardRace = Effect.fn('test.forwardRace')(function* (
    sessionId: string,
    target: { readonly chatId: bigint; readonly topicId: null },
    resend: string | null
) {
    const outcomes = yield* Effect.all(
        Array.from({ length: 8 }, () => forwardPoll(sessionId, target, { resend, approval: ownerApproval }).pipe(Effect.exit)),
        { concurrency: 'unbounded' }
    );
    const forwards = raceRecorder.calls.filter(call => call.method === 'forwardMessage' && call.payload.chat_id === Number(target.chatId));

    return { sent: outcomes.filter(outcome => outcome._tag === 'Success').length, forwards: forwards.length };
});
const unique = () => `${Math.floor(performance.now() * 1000)}-${Math.random().toString(36).slice(2, 8)}`;

const postgresLayer = Layer.mergeAll(localPostgresLayer(raceDatabaseUrl), recordingTelegramLayer(raceRecorder), Access.layerFor([42n]));

layer(postgresLayer, { timeout: 120_000, excludeTestServices: true })('admin state races on a real Postgres', it => {
    it.effect.skipIf(isEmptyString(raceDatabaseUrl))('hands typed input and a confirmation to exactly one of many racers', () =>
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

    it.effect.skipIf(isEmptyString(raceDatabaseUrl))('creates one game when ✅ is tapped many times at once', () =>
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
            const outcomes = yield* confirmAll(Array.from({ length: racers }, () => actionId));
            const games = yield* db.select().from(session).where(eq(session.communityId, communityId));

            expect(outcomes.filter(outcome => outcome._tag === 'done')).toHaveLength(1);
            expect(games).toHaveLength(1);
        })
    );

    it.effect.skipIf(withoutPostgres)('never deletes a game whose player vote was counted at the same time', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig(`race-delete-${unique()}`));
            yield* linkGroup(communityId, { chatId: -1 });
            const outcomes = yield* Effect.all(
                Array.from({ length: rounds }, (_, round) =>
                    Effect.gen(function* () {
                        const sessionId = yield* menuGame(communityId, `${10 + round}:00`);
                        const pollId = `race-delete-${unique()}-${round}`;
                        yield* db
                            .insert(telegramPoll)
                            .values({ pollId, chatId: -1n, messageId: round + 1, sessionId, options: ['in', 'out'] });
                        const [voted, deleted] = yield* Effect.all(
                            [
                                applyPollAnswer({ pollId, user: { id: BigInt(9_100_000 + round), firstName: 'Player' }, optionIds: [0] }),
                                deleteSession({
                                    communityId,
                                    sessionId,
                                    today: '2030-01-01',
                                    actorPersonId: null,
                                    approval: ownerApproval
                                }).pipe(Effect.exit)
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
            const actionIds = yield* Effect.all(
                Array.from({ length: 6 }, () => proposeAction({ communityId, tgUserId: 42n, action, summary: 'same game', now })),
                { concurrency: 1 }
            );
            const outcomes = yield* confirmAll(actionIds);
            const games = yield* db.select().from(session).where(eq(session.communityId, communityId));

            expect(games).toHaveLength(1);
            expect(outcomes.filter(outcome => outcome._tag === 'done')).toHaveLength(1);
            expect(outcomes.filter(outcome => outcome._tag === 'failed' && outcome.failure.code === 'game_exists')).toHaveLength(5);
        })
    );

    it.effect.skipIf(withoutPostgres)('forwards a poll to a group once when it is sent many times at once', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig(`race-forward-${unique()}`));
            const sessionId = yield* createSession({
                communityId,
                timezone: 'Europe/Vienna',
                title: null,
                actorPersonId: null,
                venueId: null,
                capacityMax: 14,
                localDate: '2030-12-07',
                localTime: '19:00'
            });
            const pollId = `race-forward-${unique()}`;
            const target = { chatId: -9_400_000n - BigInt(Math.floor(performance.now())), topicId: null };
            yield* linkGroup(communityId, { chatId: Number(target.chatId) });
            yield* db.insert(telegramPoll).values({ pollId, chatId: -1n, messageId: 1, sessionId, options: ['in', 'out'] });
            expect(yield* forwardRace(sessionId, target, null)).toEqual({ sent: 1, forwards: 1 });
        })
    );

    it.effect.skipIf(withoutPostgres)('lands one of many writes over the same loaded draft and never hands a revision out twice', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedCommunity(seedConfig(`race-draft-${unique()}`));
            const tgUserId = BigInt(Math.floor(performance.now() * 10));
            const state = { tgUserId, communityId, messageId: 1, awaiting: null, now };
            const loaded = yield* saveAdminState({ ...state, draft: { step: 0 } });
            const writes = yield* Effect.all(
                Array.from({ length: racers }, (_, index) => replaceAdminState({ ...state, draft: { step: index + 1 } }, loaded.revision)),
                { concurrency: 'unbounded' }
            );
            const churn = yield* Effect.all(
                Array.from({ length: racers }, (_, index) =>
                    index % 2 === 0 ? saveAdminState({ ...state, draft: { step: index } }) : clearAdminState(tgUserId).pipe(Effect.as(null))
                ),
                { concurrency: 'unbounded' }
            );
            const revisions = churn.filter(row => isDefined(row)).map(row => row.revision);

            expect(writes.filter(entry => Option.isSome(entry))).toHaveLength(1);
            expect(new Set(revisions).size).toBe(revisions.length);
            expect(revisions.every(revision => revision > loaded.revision)).toBe(true);
        })
    );

    it.effect.skipIf(withoutPostgres)('stops the poll once when two deletes of one game run at the same time', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig(`race-delete-twice-${unique()}`));
            yield* linkGroup(communityId, { chatId: -2 });
            const sessionId = yield* menuGame(communityId, '19:00');
            const messageId = Math.floor(performance.now());
            yield* db
                .insert(telegramPoll)
                .values({ pollId: `race-twice-${unique()}`, chatId: -2n, messageId, sessionId, options: ['in', 'out'] });
            const outcomes = yield* Effect.all(
                Array.from({ length: 4 }, () =>
                    deleteSession({ communityId, sessionId, today: '2030-01-01', actorPersonId: null, approval: ownerApproval }).pipe(
                        Effect.exit
                    )
                ),
                { concurrency: 'unbounded' }
            );
            const stops = raceRecorder.calls.filter(call => call.method === 'stopPoll' && call.payload.message_id === messageId);

            expect(outcomes.filter(outcome => outcome._tag === 'Success')).toHaveLength(1);
            expect(stops).toHaveLength(1);
        })
    );

    it.effect.skipIf(withoutPostgres)('sends a retried forward once when its button is tapped many times at once', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig(`race-resend-${unique()}`));
            const sessionId = yield* menuGame(communityId, '20:00');
            const pollId = `race-resend-${unique()}`;
            const target = { chatId: -9_500_000n - BigInt(Math.floor(performance.now())), topicId: null };
            yield* linkGroup(communityId, { chatId: Number(target.chatId) });
            yield* db.insert(telegramPoll).values({ pollId, chatId: -1n, messageId: 1, sessionId, options: ['in', 'out'] });
            yield* db.insert(pollForward).values({ pollId, chatId: target.chatId, token: retryToken });
            expect(yield* forwardRace(sessionId, target, retryToken)).toEqual({ sent: 1, forwards: 1 });
        })
    );
});
