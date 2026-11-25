import { expect, layer } from '@effect/vitest';
import { telegramPoll } from '@rondo/db/schema/platform.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { runTeamsTick } from '../src/jobs/teams.job';
import { teamsData } from '../src/menu/teams/teams-callback';

import { conversation, deliver } from './support/conversation';
import { setNow } from './support/fixed-clock';
import { teamsGame } from './support/teams-game';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const at = (time: string) => new Date(`2026-11-27T${time}:00Z`);
const proposals = (chatId: number) =>
    recorder.calls.filter(
        call => call.method === 'sendMessage' && call.payload.chat_id === chatId && String(call.payload.text).includes('готові')
    ).length;
const notes = (chatId: number) =>
    recorder.calls
        .filter(call => call.method === 'sendMessage' && call.payload.chat_id === chatId && String(call.payload.text).includes('🔄'))
        .map(call => /🔄 Склад змінився: (?<changes>.*)/u.exec(String(call.payload.text))?.groups?.changes ?? '');
const tick = (time: string) => setNow(at(time).getTime()).pipe(Effect.andThen(runTeamsTick(at(time))));
const startAt = Effect.fn('test.startAt')(function* (sessionId: string, time: string) {
    const db = yield* Db;
    yield* db
        .update(session)
        .set({ startsAt: at(time) })
        .where(eq(session.id, sessionId));
});
const vote = (pollId: string, userId: number, time: string) =>
    setNow(at(time).getTime()).pipe(
        Effect.andThen(
            deliver({
                poll_answer: {
                    poll_id: pollId,
                    user: { id: userId, is_bot: false, first_name: `Voter ${userId}` },
                    option_ids: [0],
                    option_persistent_ids: []
                }
            })
        )
    );

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('the hourly check', it => {
    it.effect('proposes at the last hourly check at least an hour before the start, for starts on the hour and at half past', () =>
        Effect.gen(function* () {
            const onTheHour = yield* teamsGame('hourly-1800', { groupChatId: -3501, adminId: 381, players: 10 });
            const halfBefore = yield* teamsGame('hourly-1730', { groupChatId: -3502, adminId: 382, players: 10 });
            const halfAfter = yield* teamsGame('hourly-1830', { groupChatId: -3503, adminId: 383, players: 10 });
            yield* startAt(halfBefore.sessionId, '17:30');
            yield* startAt(halfAfter.sessionId, '18:30');
            const sent: number[][] = [];

            for (const time of ['15:00', '16:00', '17:00', '18:00']) {
                yield* tick(time);
                sent.push([381, 382, 383].map(chatId => proposals(chatId)));
            }

            expect(sent).toEqual([
                [0, 0, 0],
                [0, 1, 0],
                [1, 1, 1],
                [1, 1, 1]
            ]);
            expect(onTheHour.sessionId).toBeDefined();
        })
    );

    it.effect('follows a moved game, sends after a missed hour while the game has not started, and sends once on a retry', () =>
        Effect.gen(function* () {
            yield* teamsGame('hourly-moved', { groupChatId: -3511, adminId: 384, players: 10 });
            const missed = yield* teamsGame('hourly-missed', { groupChatId: -3512, adminId: 385, players: 10 });
            const lost = yield* teamsGame('hourly-lost', { groupChatId: -3513, adminId: 386, players: 10 });
            yield* setNow(at('09:00').getTime());
            const admin = conversation(recorder, adminNumbered(384));
            yield* admin.type('/games');
            yield* admin.tap('Пт 27.11 19:00');
            yield* admin.tap('🕖 Час');
            yield* admin.type('20:30');
            yield* admin.tap('✅ Змінити й написати в «Games»');
            yield* startAt(missed.sessionId, '18:30');
            yield* tick('16:00');
            const atFour = [proposals(384), proposals(385), proposals(386)];
            yield* tick('18:00');
            yield* tick('18:00');
            const atSix = [proposals(384), proposals(385), proposals(386)];

            expect(atFour).toEqual([0, 0, 0]);
            expect(atSix).toEqual([1, 1, 0]);
            expect(lost.sessionId).toBeDefined();
        })
    );

    it.effect(
        'delivers a late change held by the five-minute pause with the next vote, an admin tap in that game or the next hourly check, and a vote that changes nothing keeps the pause',
        () =>
            Effect.gen(function* () {
                const db = yield* Db;
                const { sessionId } = yield* teamsGame('hourly-notes', { groupChatId: -3521, adminId: 387, players: 10 });
                yield* startAt(sessionId, '18:30');
                yield* db
                    .insert(telegramPoll)
                    .values({ pollId: 'poll-hourly', chatId: -3521n, messageId: 7, sessionId, options: ['in', 'gk', 'out'] });
                yield* tick('17:00');
                yield* vote('poll-hourly', 38_700, '17:07');
                yield* vote('poll-hourly', 39_871, '17:10');
                yield* vote('poll-hourly', 39_872, '17:12');
                const held = notes(387).length;
                yield* vote('poll-hourly', 39_873, '17:16');
                const byVote = notes(387).at(-1);
                yield* vote('poll-hourly', 39_874, '17:18');
                const admin = conversation(recorder, adminNumbered(387));
                yield* setNow(at('17:25').getTime());
                yield* admin.press(teamsData({ sessionId, version: 0, page: 0 }, 'e'));
                const byTap = notes(387).at(-1);
                yield* vote('poll-hourly', 39_875, '17:27');
                yield* tick('18:00');
                const byCheck = notes(387).at(-1);

                expect(held).toBe(1);
                expect(byVote).toBe('+2: Voter 39872, Voter 39873');
                expect(byTap).toBe('+1: Voter 39874');
                expect(byCheck).toBe('+1: Voter 39875');
            })
    );
});
