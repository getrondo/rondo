import { expect, layer } from '@effect/vitest';
import { pollForward, telegramPoll } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { createSession } from '../src/sessions/session.service';
import { forwardPoll } from '../src/signups/forward-poll';
import { recordedTelegramDbLayer, recorder } from '../src/testing/recorded-telegram.layer';
import { seedCommunity, seedConfig } from '../src/testing/seed-community';

const second = { chatId: -7301n, topicId: null };
const forwardsTo = (chatId: bigint) =>
    recorder.calls.filter(call => call.method === 'forwardMessage' && call.payload.chat_id === Number(chatId)).length;

const reasonOf = (exit: unknown): string => JSON.stringify(exit);

layer(recordedTelegramDbLayer, { timeout: 60_000 })('forward claims', it => {
    it.effect('claims a group once, keeps the claim when the result is unknown and frees it after a refusal', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedCommunity(seedConfig('forward-claim-fc'));
            const sessionId = yield* createSession({
                communityId,
                timezone: 'Europe/Vienna',
                localDate: '2026-12-05',
                localTime: '10:00',
                venueId: null,
                capacityMax: null,
                title: null,
                actorPersonId: null
            });
            yield* db
                .insert(telegramPoll)
                .values({ pollId: 'claim-poll', chatId: -7300n, messageId: 5, sessionId, options: ['in', 'out'] });
            const tokenNow = () =>
                db
                    .select({ token: pollForward.token })
                    .from(pollForward)
                    .where(eq(pollForward.pollId, 'claim-poll'))
                    .pipe(Effect.map(([row]) => row?.token ?? ''));
            recorder.failures.set('forwardMessage', new Error('socket hang up'));
            const unknown = yield* forwardPoll(sessionId, second, null).pipe(Effect.exit);
            recorder.failures.delete('forwardMessage');
            const again = yield* forwardPoll(sessionId, second, null).pipe(Effect.exit);
            const afterAgain = forwardsTo(second.chatId);
            const first = yield* tokenNow();
            recorder.failures.set('forwardMessage', refusal('forwardMessage', 'Bad Request: not enough rights'));
            const refused = yield* forwardPoll(sessionId, second, first).pipe(Effect.exit);
            recorder.failures.delete('forwardMessage');
            const claimsAfterRefusal = yield* db.select().from(pollForward).where(eq(pollForward.pollId, 'claim-poll'));
            const ghost = yield* forwardPoll(sessionId, second, first).pipe(Effect.exit);
            const afterGhost = forwardsTo(second.chatId);
            recorder.failures.set('forwardMessage', new Error('socket hang up'));
            yield* forwardPoll(sessionId, second, null).pipe(Effect.exit);
            const second2 = yield* tokenNow();
            yield* forwardPoll(sessionId, second, second2).pipe(Effect.exit);
            recorder.failures.delete('forwardMessage');
            const stale = yield* forwardPoll(sessionId, second, second2).pipe(Effect.exit);
            const afterStale = forwardsTo(second.chatId);
            const sent = yield* forwardPoll(sessionId, second, yield* tokenNow()).pipe(Effect.exit);
            const [claim] = yield* db.select().from(pollForward).where(eq(pollForward.pollId, 'claim-poll'));

            expect(reasonOf(unknown)).toContain('the forward result is uncertain');
            expect(reasonOf(again)).toContain('the forward result is uncertain');
            expect(afterAgain).toBe(1);
            expect(refused._tag).toBe('Failure');
            expect(claimsAfterRefusal).toEqual([]);
            expect(ghost._tag).toBe('Failure');
            expect(afterGhost).toBe(2);
            expect(second2).not.toBe(first);
            expect(reasonOf(stale)).toContain('the forward result is uncertain');
            expect(afterStale).toBe(4);
            expect(sent._tag).toBe('Success');
            expect(claim?.messageId).toBeTypeOf('number');
            expect(forwardsTo(second.chatId)).toBe(5);
        })
    );
});
