import { expect, layer } from '@effect/vitest';
import { footballHistory } from '@rondo/core/menu/game-history.repository';
import { extraction, ingestRun, messageRef, sourceRef } from '@rondo/db/schema/platform.schema';
import { signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder, refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation, deliver, lastPollId } from './support/conversation';
import { setNow } from './support/fixed-clock';
import { gamesOn, seedSeason, seedSecondGroup } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const callsTo = (chatId: number, method: string) =>
    recorder.calls.filter(call => call.method === method && call.payload.chat_id === chatId);
const voter = (id: number) => ({ id, is_bot: false as const, first_name: `Voter ${id}` });

const pollIdIn = (chatId: number) => lastPollId(recorder, chatId);

const importPosts = Effect.fn('test.importPosts')(function* (communityId: string, posted: readonly (typeof messageRef.$inferSelect)[]) {
    const db = yield* Db;
    const [run] = yield* db
        .insert(ingestRun)
        .values({ communityId, source: 'telegram_json', fileSha256: 'sha', parserVersion: '2' })
        .returning();

    for (const { chatId, messageId, entityId } of posted) {
        const [ref] = yield* db
            .insert(sourceRef)
            .values({ runId: run?.id ?? '', communityId, chatId: Number(chatId), messageId, sentAt: new Date(0), kind: 'poll' })
            .returning();
        yield* db.insert(extraction).values({ sourceRefId: ref?.id ?? '', entityType: 'scheduling.session', entityId });
    }
});

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('one poll, several groups', it => {
    it.effect('posts the usual Wednesday to the second group in two taps', () =>
        Effect.gen(function* () {
            const { communityId, park } = yield* seedSeason('aud-wednesday', { groupChatId: -4001, adminId: 701 });
            yield* seedSecondGroup(communityId, { main: -4001, second: -4002, venueId: park });
            yield* setNow(Date.parse('2026-12-01T09:00:00Z'));
            const admin = conversation(recorder, adminNumbered(701));
            yield* admin.type('/newgame');
            const main = admin.screen();
            yield* admin.tap('✅ Надіслати');
            const [game] = yield* gamesOn(communityId, '2026-12-02');

            expect(main.buttons[0]?.map(button => button.text)).toEqual(['✅ Надіслати в «Second»']);
            expect(callsTo(-4002, 'sendPoll')).toHaveLength(1);
            expect(callsTo(-4001, 'sendPoll')).toHaveLength(0);
            expect(game).toMatchObject({ venueId: park, capacityMax: 18 });
        })
    );

    it.effect('posts the Friday to both groups as one poll and one forward, and counts a vote from the copy once', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, park } = yield* seedSeason('aud-both', { groupChatId: -4011, adminId: 702 });
            yield* seedSecondGroup(communityId, { main: -4011, second: -4012, venueId: park });
            const admin = conversation(recorder, adminNumbered(702));
            yield* admin.type('/newgame');
            const main = admin.screen();
            yield* admin.tap('✅ Надіслати');
            const pollId = pollIdIn(-4011);
            const answer = { poll_id: pollId, user: voter(9201), option_ids: [0], option_persistent_ids: [] };
            yield* deliver({ poll_answer: answer });
            yield* deliver({ poll_answer: answer });
            const [game] = yield* gamesOn(communityId, '2026-11-27');
            const signups = yield* db
                .select()
                .from(signup)
                .where(eq(signup.sessionId, game?.id ?? ''));

            expect(main.buttons[0]?.map(button => button.text)).toEqual(['✅ Надіслати в обидві групи']);
            expect(callsTo(-4011, 'sendPoll')).toHaveLength(1);
            expect(callsTo(-4012, 'forwardMessage')[0]?.payload).toMatchObject({ from_chat_id: -4011 });
            expect(callsTo(-4012, 'sendPoll')).toHaveLength(0);
            expect(signups).toHaveLength(1);
        })
    );

    it.effect('opens a full game to the second group later, reports a refused forward and mentions the promoted player in both', () =>
        Effect.gen(function* () {
            const { communityId, park } = yield* seedSeason('aud-later', { groupChatId: -4021, adminId: 703 });
            yield* seedSecondGroup(communityId, { main: -4021, second: -4022, venueId: park });
            const admin = conversation(recorder, adminNumbered(703));
            yield* admin.type('/newgame');
            yield* admin.tap('📤 Куди');
            const choices = admin.labels().flat();
            yield* admin.tap('«Games»');
            yield* admin.tap('👥 22');
            yield* admin.type('2');
            yield* admin.tap('✅ Надіслати');
            const pollId = pollIdIn(-4021);
            const vote = (id: number, optionIds: number[]) =>
                deliver({ poll_answer: { poll_id: pollId, user: voter(id), option_ids: optionIds, option_persistent_ids: [] } });
            yield* vote(9301, [0]);
            yield* vote(9302, [0]);
            yield* vote(9303, [0]);
            yield* admin.type('/games');
            yield* admin.tap('Пт 27.11 19:00');
            const card = admin.screen();
            yield* admin.tap('📣 Надіслати ще в «Second»');
            const confirmation = admin.screen().text;
            recorder.failures.set('forwardMessage', refusal('forwardMessage', 'Bad Request: not enough rights'));
            yield* admin.tap('✅ Надіслати в «Second»');
            recorder.failures.delete('forwardMessage');
            const refused = admin.screen();
            yield* admin.tap('📣 Надіслати ще в «Second»');
            yield* admin.tap('✅ Надіслати в «Second»');
            const opened = admin.screen();
            yield* vote(9301, []);
            const mentions = [-4021, -4022].map(chatId => callsTo(chatId, 'sendMessage').at(-1)?.payload.text);

            expect(card.text).toContain('Записались 2 з 2 · вільно 0');
            expect(choices).toEqual(['👤 Тільки мені', '«Games»', '«Second»', '✓ «Games» і «Second»', '⬅️ Назад']);
            expect(confirmation).toContain('Так буде в «Second»:');
            expect(refused.text).toContain('Telegram не прийняв');
            expect(refused.buttons.flat().map(button => button.text)).toContain('📣 Надіслати ще в «Second»');
            expect(opened.buttons.flat().map(button => button.text)).not.toContain('📣 Надіслати ще в «Second»');
            expect(opened.text.split('\n')[0]).toBe('✅ Опитування тепер і в «Second».');
            expect(callsTo(-4022, 'sendPoll')).toHaveLength(0);
            expect(mentions.every(text => String(text).includes('Voter 9303'))).toBe(true);
        })
    );

    it.effect('posts the usual Wednesday to the second group when its games came from an import', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, park } = yield* seedSeason('aud-imported', { groupChatId: -4091, adminId: 709 });
            yield* seedSecondGroup(communityId, { main: -4091, second: -4092, venueId: park });
            yield* importPosts(communityId, yield* db.delete(messageRef).where(eq(messageRef.chatId, -4092n)).returning());
            yield* setNow(Date.parse('2026-12-01T09:00:00Z'));
            const admin = conversation(recorder, adminNumbered(709));
            yield* admin.type('/newgame');
            const main = admin.screen();
            yield* admin.tap('✅ Надіслати');

            expect(main.buttons[0]?.map(button => button.text)).toEqual(['✅ Надіслати в «Second»']);
            expect(callsTo(-4092, 'sendPoll')).toHaveLength(1);
            expect(callsTo(-4091, 'sendPoll')).toHaveLength(0);
        })
    );

    it.effect('posts once to a group whose games the bot and an import both know', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, park } = yield* seedSeason('aud-known-twice', { groupChatId: -4101, adminId: 710 });
            yield* seedSecondGroup(communityId, { main: -4101, second: -4102, venueId: park });
            yield* importPosts(communityId, yield* db.select().from(messageRef).where(eq(messageRef.chatId, -4102n)));
            const history = yield* footballHistory(communityId, '2026-01-01', ['training']);

            const inSecond = history.map(({ chatIds }) => chatIds ?? []).filter(ids => ids.includes('-4102'));

            expect(inSecond.length).toBeGreaterThan(0);
            expect(inSecond.map(ids => new Set(ids).size)).toEqual(inSecond.map(ids => ids.length));
        })
    );
});
