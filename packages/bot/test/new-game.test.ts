import { expect, layer } from '@effect/vitest';
import { AiGateway } from '@rondo/assistant/service/ai-gateway.service';
import { Access } from '@rondo/core/access/admin-access';
import { roleGrant } from '@rondo/db/schema/org.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { testDbLayer } from '@rondo/db/testing/test-db.layer';
import { makeRecorder, recordingTelegramLayer, refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { MockLanguageModelV4 } from 'ai/test';
import { and, eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import { conversation } from './support/conversation';
import { advanceNow, fixedClockLayer } from './support/fixed-clock';
import { grantOrganizer, seedSeason } from './support/season';

const adminNumbered = (id: number, languageCode = 'uk') => ({
    id,
    is_bot: false as const,
    first_name: `Admin ${id}`,
    language_code: languageCode
});
const recorder = makeRecorder();
let modelCalls = 0;
const brokenModel = new MockLanguageModelV4({
    doGenerate: async () => {
        modelCalls += 1;

        return await Promise.reject(new Error('gateway down'));
    }
});
const testLayer = Layer.mergeAll(
    testDbLayer,
    recordingTelegramLayer(recorder),
    AiGateway.layerFor(brokenModel),
    Access.layerFor([42n]),
    fixedClockLayer
);

const gamesOf = Effect.fn('test.gamesOf')(function* (communityId: string, localDate: string) {
    const db = yield* Db;

    return yield* db
        .select()
        .from(session)
        .where(and(eq(session.communityId, communityId), eq(session.localDate, localDate)));
});
const pollsTo = (chatId: number) => recorder.calls.filter(call => call.method === 'sendPoll' && call.payload.chat_id === chatId);

layer(testLayer, { timeout: 60_000, excludeTestServices: true })('/newgame', it => {
    it.effect('posts the usual Friday game with two taps and shows its card', () =>
        Effect.gen(function* () {
            const { communityId, north } = yield* seedSeason('ng-friday', { groupChatId: -1001, adminId: 101 });
            const owner = adminNumbered(101);
            const admin = conversation(recorder, owner);
            yield* admin.type('/newgame');
            const main = admin.screen();
            yield* admin.tap('✅ Опублікувати');
            const [game] = yield* gamesOf(communityId, '2026-11-27');
            const [poll] = pollsTo(-1001);

            expect(main.text).toContain('⚽ Пʼятниця, 27 листопада, 19.00 North Arena');
            expect(main.text).toContain('1 поле, 22 місця');
            expect(main.buttons.map(row => row.map(button => button.text))).toEqual([
                ['✅ Опублікувати'],
                ['Пн 30.11 18:30 · Park Field'],
                ['👥 −', '👥 22', '👥 +'],
                ['🕖 19:00', '📍 North Arena', '📅 Пт 27.11'],
                ['📍 Адреса', '🛠 Вручну', '✖️']
            ]);
            expect(game).toMatchObject({ venueId: north, capacityMax: 22, fieldsPlanned: 1, status: 'open' });
            expect(poll?.payload).toMatchObject({ description: '📍 <b>North Arena</b>', description_parse_mode: 'HTML' });
            expect(admin.screen().id).toBe(main.id);
            expect(admin.screen().text).toContain('✅');
            expect(admin.screen().text).toContain('Пт 27.11 19:00 · North Arena');
            expect(admin.tidy()).toEqual({ unanswered: [], oversized: [] });
        })
    );

    it.effect('swaps to the usual Monday, adds places, changes time and place, and keeps Back on every list', () =>
        Effect.gen(function* () {
            const { communityId, park } = yield* seedSeason('ng-monday', { groupChatId: -1002, adminId: 102 });
            const owner = adminNumbered(102);
            const admin = conversation(recorder, owner);
            yield* admin.type('/newgame');
            yield* admin.tap('Пн 30.11 18:30 · Park Field');
            const monday = admin.screen();
            yield* admin.tap('👥 +');
            yield* admin.tap('👥 +');
            yield* admin.tap('🕖 18:30');
            const times = admin.labels();
            yield* admin.tap('⬅️ Назад');
            yield* admin.tap('🕖 18:30');
            yield* admin.tap('19:00');
            yield* admin.tap('📍 Park Field');
            const places = admin.labels();
            yield* admin.tap('North Arena');
            yield* admin.tap('📍 North Arena');
            yield* admin.tap('Park Field');
            yield* admin.tap('👥 +');
            const ready = admin.screen();
            yield* admin.tap('✅ Опублікувати');
            const [game] = yield* gamesOf(communityId, '2026-11-30');

            expect(monday.text).toContain('Понеділок, 30 листопада, 18.30 Park Field');
            expect(times.flat()).toEqual(expect.arrayContaining(['18:00', '✓ 18:30', '19:00', '⬅️ Назад']));
            expect(places.flat()).toEqual(
                expect.arrayContaining(['✓ Park Field', 'North Arena', '📍 Інше місце', '➕ Нове місце', '⬅️ Назад'])
            );
            expect(ready.buttons[2]?.map(button => button.text)).toEqual(['👥 −', '👥 19', '👥 +']);
            expect(game).toMatchObject({ venueId: park, capacityMax: 19 });
            expect(admin.tidy()).toEqual({ unanswered: [], oversized: [] });
        })
    );

    it.effect('types another time, an unusual date and a new place with its pin, and refuses the past', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('ng-typed', { groupChatId: -1003, adminId: 103 });
            const owner = adminNumbered(103);
            const admin = conversation(recorder, owner);
            yield* admin.type('/newgame');
            yield* admin.tap('🕖 19:00');
            yield* admin.type('20:15');
            yield* admin.tap('📅 Пт 27.11');
            yield* admin.type('20.11.2026');
            const refused = admin.screen().text;
            yield* admin.type('5.12');
            yield* admin.tap('📍 North Arena');
            yield* admin.tap('➕ Нове місце');
            yield* admin.type('River Court');
            const pinAsked = admin.screen();
            yield* admin.location(48.2, 16.4);
            const ready = admin.screen();
            yield* admin.tap('✅ Опублікувати');
            const [game] = yield* gamesOf(communityId, '2026-12-05');
            const [poll] = pollsTo(-1003);

            expect(refused).toContain('минул');
            expect(pinAsked.buttons.flat().map(button => button.text)).toContain('⏭ Пропустити');
            expect(ready.text).toContain('Субота, 5 грудня, 20.15 River Court');
            expect(game?.capacityMax).toBe(22);
            expect(poll?.payload.reply_markup).toEqual({
                inline_keyboard: [[{ text: '🗺 Маршрут', url: 'https://www.google.com/maps/search/?api=1&query=48.2,16.4' }]]
            });
        })
    );

    it.effect('walks the manual steps and creates a game without a poll', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('ng-manual', { groupChatId: -1004, adminId: 104 });
            const owner = adminNumbered(104);
            const admin = conversation(recorder, owner);
            yield* admin.type('/newgame');
            yield* admin.tap('🛠 Вручну');
            yield* admin.tap('Сб 28.11');
            yield* admin.tap('➕ Нове місце');
            yield* admin.type('Hill Park');
            yield* admin.tap('⏭ Пропустити');
            yield* admin.type('17:00');
            yield* admin.tap('♾ Без ліміту');
            const preview = admin.screen();
            yield* admin.tap('💾 Без опитування');
            const [game] = yield* gamesOf(communityId, '2026-11-28');

            expect(preview.text).toContain('Субота, 28 листопада, 17.00 Hill Park');
            expect(game).toMatchObject({ capacityMax: null, status: 'open' });
            expect(pollsTo(-1004)).toHaveLength(0);
        })
    );

    it.effect('discards a draft with ✖️ and offers only a game without a poll when no group is linked', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('ng-nogroup', { groupChatId: null, adminId: 105 });
            const owner = adminNumbered(105);
            const admin = conversation(recorder, owner);
            yield* admin.type('/newgame');
            yield* admin.tap('✖️');
            const home = admin.screen().text;
            yield* admin.type('/newgame');
            const main = admin.screen();
            yield* admin.tap('💾 Створити без опитування');
            const [game] = yield* gamesOf(communityId, '2026-11-27');

            expect(home).toContain('Rondo');
            expect(main.text).toContain('Групу не підключено');
            expect(main.buttons[0]?.map(button => button.text)).toEqual(['💾 Створити без опитування']);
            expect(game?.status).toBe('open');
        })
    );

    it.effect('works while the AI gateway is down and hands other text to the assistant', () =>
        Effect.gen(function* () {
            yield* seedSeason('ng-ai', { groupChatId: -1006, adminId: 106 });
            const owner = adminNumbered(106);
            const admin = conversation(recorder, owner);
            const before = modelCalls;
            yield* admin.type('/newgame');
            yield* admin.tap('🕖 19:00');
            yield* admin.type('/menu');
            yield* admin.type('20:15');
            const reply = admin.screen().text;

            expect(modelCalls).toBeGreaterThan(before);
            expect(reply).toContain('Не вдалося обробити запит');
        })
    );

    it.effect('keeps two admins apart, consumes ✅ once and refuses an expired or revoked draft', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedSeason('ng-two', { groupChatId: -1007, adminId: 107 });
            const owner = adminNumbered(107);
            const second = adminNumbered(143, 'ru');
            yield* grantOrganizer(communityId, second.id);
            const first = conversation(recorder, owner);
            const other = conversation(recorder, second);
            yield* first.type('/newgame');
            yield* other.type('/newgame');
            yield* other.tap('Пн 30.11 18:30 · Park Field');
            yield* first.tap('👥 +');
            const ready = first.screen();
            yield* first.tapOn(ready, '✅ Опублікувати');
            yield* first.tapOn(ready, '✅ Опублікувати');
            yield* advanceNow(31 * 60_000);
            yield* other.tap('✅ Опубликовать');
            const expired = recorder.calls.findLast(call => call.method === 'answerCallbackQuery')?.payload;
            yield* other.type('/newgame');
            yield* db
                .update(roleGrant)
                .set({ valid: sql`tstzrange('2020-01-01', '2020-01-02')` })
                .where(eq(roleGrant.communityId, communityId));
            yield* other.tap('✅ Опубликовать');
            const friday = yield* gamesOf(communityId, '2026-11-27');
            const monday = yield* gamesOf(communityId, '2026-11-30');

            expect(friday.map(game => game.capacityMax)).toEqual([23]);
            expect(pollsTo(-1007)).toHaveLength(1);
            expect(String(expired?.text)).toContain('устарел');
            expect(monday).toHaveLength(0);
            expect(other.screen().text).toContain('администратор');
        })
    );

    it.effect('keeps the draft when Telegram refuses the poll and says what to do', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('ng-refused', { groupChatId: -1008, adminId: 108 });
            const owner = adminNumbered(108);
            const admin = conversation(recorder, owner);
            yield* admin.type('/newgame');
            recorder.failures.set('sendPoll', refusal('sendPoll', 'Bad Request: not enough rights to send polls to the chat'));
            yield* admin.tap('✅ Опублікувати');
            recorder.failures.delete('sendPoll');
            const refused = admin.screen();
            const none = yield* gamesOf(communityId, '2026-11-27');
            yield* admin.tap('✅ Опублікувати');
            const created = yield* gamesOf(communityId, '2026-11-27');

            expect(refused.text).toContain('Telegram');
            expect(none).toHaveLength(0);
            expect(created).toHaveLength(1);
        })
    );
});
