import { expect, layer } from '@effect/vitest';
import { telegramPoll } from '@rondo/db/schema/platform.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { createSession, getSession } from '../src/sessions/session.service';
import { announceSession, applyPollAnswer } from '../src/signups/signup.service';
import { recordedTelegramDbLayer, recorder } from '../src/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

const user = (id: number) => ({ id: BigInt(id), firstName: `Player${id}` });

layer(recordedTelegramDbLayer, { timeout: 60_000 })('sign-ups through the bot poll', it => {
    it.effect('waitlists over capacity and promotes the first waiting player when a seat frees up', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('signup-fc'));
            const sessionId = yield* createSession({
                communityId,
                timezone: 'Europe/Vienna',
                localDate: '2026-12-04',
                localTime: '19:30',
                venueId: null,
                capacityMax: 2,
                title: null,
                actorPersonId: null
            });
            const target = Option.getOrThrow(yield* getSession(sessionId));
            yield* announceSession(target, { chatId: -100_123n, topicId: null }, null);
            const [poll] = yield* db
                .select({ pollId: telegramPoll.pollId })
                .from(telegramPoll)
                .where(eq(telegramPoll.sessionId, sessionId));
            const pollId = poll?.pollId ?? '';
            const answer = (id: number, option: number) => applyPollAnswer({ pollId, user: user(id), optionIds: [option] });

            const first = yield* answer(1, 0);
            yield* answer(2, 0);
            yield* db
                .insert(telegramPoll)
                .values({ pollId: 'older', chatId: -100_123n, messageId: 1, sessionId, options: ['in', 'gk', 'out'] });
            const keeper = yield* applyPollAnswer({ pollId: 'older', user: user(4), optionIds: [1] });
            const refused = yield* applyPollAnswer({ pollId: 'older', user: user(5), optionIds: [2] });
            const third = yield* answer(3, 0);
            const [full] = yield* db.select({ status: session.status }).from(session).where(eq(session.id, sessionId));
            const leaving = yield* answer(1, 1);
            const statuses = yield* db
                .select({ status: signup.status, role: signup.role })
                .from(signup)
                .where(eq(signup.sessionId, sessionId));

            expect(recorder.calls.find(call => call.method === 'sendPoll')?.payload).toMatchObject({
                chat_id: -100_123,
                is_anonymous: false
            });
            expect(first.pipe(Option.map(value => value.status))).toEqual(Option.some('in'));
            expect(keeper.pipe(Option.map(value => value.status))).toEqual(Option.some('in'));
            expect(refused.pipe(Option.map(value => value.status))).toEqual(Option.some('out'));
            expect(third.pipe(Option.map(value => value.status))).toEqual(Option.some('waitlisted'));
            expect(full?.status).toBe('full');
            expect(leaving.pipe(Option.map(value => value.promoted.map(player => player.displayName)))).toEqual(Option.some(['Player3']));
            expect(statuses.filter(row => row.status === 'in' && row.role === 'field')).toHaveLength(2);
        })
    );

    it.effect('ignores answers to polls the bot does not know', () =>
        Effect.gen(function* () {
            const outcome = yield* applyPollAnswer({ pollId: 'unknown', user: user(9), optionIds: [0] });

            expect(Option.isNone(outcome)).toBe(true);
        })
    );

    it.effect('gives the last seat to one of two votes and refuses votes after the game', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('signup-race-fc'));
            const sessionId = yield* createSession({
                communityId,
                timezone: 'Europe/Vienna',
                localDate: '2026-12-05',
                localTime: '19:30',
                venueId: null,
                capacityMax: 1,
                title: null,
                actorPersonId: null
            });
            yield* db.insert(telegramPoll).values({ pollId: 'race', chatId: -1n, messageId: 1, sessionId, options: ['in', 'gk', 'out'] });
            const answer = (id: number) => applyPollAnswer({ pollId: 'race', user: user(id), optionIds: [0] });
            yield* Effect.all([answer(21), answer(22)], { concurrency: 'unbounded' });
            const statuses = yield* db.select({ status: signup.status }).from(signup).where(eq(signup.sessionId, sessionId));
            yield* db.update(session).set({ status: 'played' }).where(eq(session.id, sessionId));
            const late = yield* answer(23);

            expect(statuses.map(row => row.status).toSorted()).toEqual(['in', 'waitlisted']);
            expect(Option.isNone(late)).toBe(true);
        })
    );

    it.effect('rolls back every domain write of a failed transaction', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('rollback-fc'));
            yield* Effect.exit(
                db.transaction(() =>
                    createSession({
                        communityId,
                        timezone: 'Europe/Vienna',
                        localDate: '2026-12-06',
                        localTime: '19:30',
                        venueId: null,
                        capacityMax: null,
                        title: null,
                        actorPersonId: null
                    }).pipe(Effect.andThen(Effect.fail('boom')))
                )
            );
            const rows = yield* db.select().from(session).where(eq(session.communityId, communityId));

            expect(rows).toEqual([]);
        })
    );
});
