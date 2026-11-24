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
            yield* announceSession(target, -100_123n, 'uk');
            const [poll] = yield* db
                .select({ pollId: telegramPoll.pollId })
                .from(telegramPoll)
                .where(eq(telegramPoll.sessionId, sessionId));
            const pollId = poll?.pollId ?? '';
            const answer = (id: number, option: number) => applyPollAnswer({ pollId, user: user(id), optionIds: [option] });

            const first = yield* answer(1, 0);
            yield* answer(2, 0);
            const keeper = yield* answer(4, 1);
            const third = yield* answer(3, 0);
            const [full] = yield* db.select({ status: session.status }).from(session).where(eq(session.id, sessionId));
            const leaving = yield* answer(1, 2);
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
});
