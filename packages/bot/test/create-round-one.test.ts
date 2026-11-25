import { expect, layer } from '@effect/vitest';
import { makeRecorder, refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Effect from 'effect/Effect';

import { conversation, labelsOf, walkManual } from './support/conversation';
import { gamesOn, seedSecondGroup, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('/newgame after the first design round', it => {
    it.effect('updates the preview from typed text without opening a list and leaves other text to the assistant', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('r1-typed', { groupChatId: -15_001, adminId: 1501 });
            const admin = conversation(recorder, adminNumbered(1501));
            yield* admin.type('/newgame');
            yield* admin.type('20:00');
            const time = admin.screen();
            yield* admin.type('18');
            const places = admin.screen();
            yield* admin.type('пн 19:30');
            const weekday = admin.screen();
            yield* admin.type('5.12');
            yield* admin.tap('✅ Надіслати');
            const [game] = yield* gamesOn(communityId, '2026-12-05');

            expect(labelsOf(time)).toContain('🕖 20:00');
            expect(labelsOf(places)).toContain('👥 18');
            expect(labelsOf(weekday)).toEqual(expect.arrayContaining(['🕖 19:30', '📅 Пн 30.11']));
            expect(game).toMatchObject({ capacityMax: 18 });
        })
    );

    it.effect('keeps the draft behind 🛠 from scratch, returns from an edit to the preview and keeps a note on several lines', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('r1-manual', { groupChatId: -15_002, adminId: 1502 });
            const admin = conversation(recorder, adminNumbered(1502));
            yield* admin.type('/newgame');
            yield* admin.tap('+1');
            yield* admin.tap('🛠 З нуля');
            const scratch = admin.screen();
            yield* admin.tap('⬅️ Назад');
            const restored = admin.screen();
            yield* walkManual(admin, ['🛠 З нуля', 'Сб 28.11', 'Park Field', '18:30', '👥 18', '🕖 18:30']);
            yield* admin.tap('⬅️ Назад');
            const preview = admin.screen();
            yield* admin.tap('📝 Рядок');
            yield* admin.type('М’ячі є\nВоротар потрібен');
            yield* admin.tap('✅ Надіслати');
            const poll = recorder.calls.findLast(call => call.method === 'sendPoll' && call.payload.chat_id === -15_002);
            const [game] = yield* gamesOn(communityId, '2026-11-28');

            expect(labelsOf(scratch)).toContain('⬅️ Назад');
            expect(labelsOf(restored)).toEqual(expect.arrayContaining(['👥 23', '📅 Пт 27.11']));
            expect(preview.text).toContain('Опитування буде таким:');
            expect(labelsOf(preview)).toEqual(expect.arrayContaining(['📝 Рядок', '💾 Зберегти без опитування']));
            expect(String(poll?.payload.question)).toContain('М’ячі є\nВоротар потрібен');
            expect(game?.capacityMax).toBe(18);
        })
    );

    it.effect('keeps the chosen place limit and destination when switching to the other likely game', () =>
        Effect.gen(function* () {
            const { communityId, park } = yield* seedSeason('r1-other', { groupChatId: -15_003, adminId: 1503 });
            yield* seedSecondGroup(communityId, { main: -15_003, second: -15_004, venueId: park });
            const admin = conversation(recorder, adminNumbered(1503));
            yield* admin.type('/newgame');
            yield* admin.tap('+1');
            yield* admin.tap('📤 Куди');
            yield* admin.tap('👤 Тільки мені');
            yield* admin.tap('↔️ ');
            const swapped = admin.screen();

            expect(labelsOf(swapped)).toEqual(expect.arrayContaining(['✅ Надіслати опитування мені', '👥 23', '📅 Пн 30.11']));
            expect(swapped.text).toContain('Опитування зʼявиться тут, у групу перешлеш ти.');
        })
    );

    it.effect('names every result of a poll sent to two groups and says plainly when one forward failed', () =>
        Effect.gen(function* () {
            const { communityId, park } = yield* seedSeason('r1-partial', { groupChatId: -15_005, adminId: 1505 });
            yield* seedSecondGroup(communityId, { main: -15_005, second: -15_006, venueId: park });
            const admin = conversation(recorder, adminNumbered(1505));
            yield* admin.type('/newgame');
            recorder.failures.set('forwardMessage', refusal('forwardMessage', 'Bad Request: chat not found'));
            yield* admin.tap('✅ Надіслати в обидві групи');
            recorder.failures.delete('forwardMessage');
            const result = admin.screen().text;

            expect(result).toContain('✅ Гру створено, опитування в «Games».');
            expect(result).toContain('⚠️ У «Second» не надіслано: Telegram не прийняв опитування, нічого не надіслано.');
        })
    );

    it.effect('sends a poll to me as a new message under it, clears the old buttons and words a refusal without group advice', () =>
        Effect.gen(function* () {
            yield* seedSeason('r1-self', { groupChatId: null, adminId: 1507 });
            const admin = conversation(recorder, adminNumbered(1507));
            yield* admin.type('/newgame');
            const preview = admin.screen();
            recorder.failures.set('sendPoll', refusal('sendPoll', 'Bad Request: poll is too long'));
            yield* admin.tap('✅ Надіслати опитування мені');
            recorder.failures.delete('sendPoll');
            const refused = admin.screen();
            yield* admin.tap('✅ Надіслати опитування мені');
            const below = admin.seen().find(message => message.id === preview.id);
            const receipt = admin.screen();

            expect(labelsOf(preview)).not.toContain('📤 Куди');
            expect(refused.text.split('\n').at(-1)).toBe('⚠️ Telegram не прийняв повідомлення, нічого не надіслано. Натисни ✅ ще раз.');
            expect(refused.text).not.toContain('адміністратор');
            expect(below).toEqual({ id: preview.id, text: '✅ Опитування нижче 👇', buttons: [] });
            expect(receipt.id).not.toBe(preview.id);
            expect(receipt.text).toBe('✅ Гру створено, опитування в тебе.\nНатисни й утримуй опитування → Переслати → група.');
            expect(admin.labels()).toEqual([['📅 Ігри', '✏️ Змінити']]);
        })
    );

    it.effect('lists days in order with today last, explains a past date in one prompt and offers usual sizes for a new place', () =>
        Effect.gen(function* () {
            yield* seedSeason('r1-lists', { groupChatId: -15_008, adminId: 1508 });
            const admin = conversation(recorder, adminNumbered(1508));
            yield* admin.type('/newgame');
            yield* admin.tap('📅 Пт 27.11');
            const days = admin.labels().flat();
            yield* admin.type('20.11.2026');
            const past = admin.screen().text;
            yield* admin.tap('⬅️ Назад');
            yield* admin.tap('📍 North Arena');
            yield* admin.tap('➕ Нове місце');
            yield* admin.type('Quarry Court');
            const offered = admin.labels();
            yield* admin.tap('⏭ Пропустити');
            yield* admin.tap('👥 22');
            const sizes = admin.labels().flat();

            expect(days.slice(0, -2)).toEqual(['✓ Пт 27.11', 'Сб 28.11', 'Нд 29.11', 'Пн 30.11', 'Вт 01.12', 'Ср 02.12']);
            expect(days.at(-2)).toBe('Сьогодні 26.11');
            expect(past.split('\n')).toHaveLength(2);
            expect(past).not.toContain('Який день');
            expect(offered).toEqual([['⏭ Пропустити'], ['⬅️ Назад']]);
            expect(admin.screen().text).not.toContain('Число полів');
            expect(sizes).toEqual(expect.arrayContaining(['👥 14', '👥 18', '✓ 👥 22', '✓ 1 поле', '2 поля', '3 поля']));
        })
    );

    it.effect('replaces a stale message with one new-game button and answers a repeated ✅ with the receipt', () =>
        Effect.gen(function* () {
            yield* seedSeason('r1-stale', { groupChatId: -15_009, adminId: 1509 });
            const admin = conversation(recorder, adminNumbered(1509));
            yield* admin.type('/newgame');
            const old = admin.screen();
            yield* admin.type('/newgame');
            yield* admin.tapOn(old, '+1');
            const stale = admin.screen();
            yield* admin.type('/newgame');
            const main = admin.screen();
            yield* admin.tapOn(main, '✅ Надіслати');
            yield* admin.tapOn(main, '✅ Надіслати');
            const receipt = admin.screen();

            expect(stale.id).toBe(old.id);
            expect(stale.text).toBe('⌛ Цей екран застарів, нічого не надіслано.');
            expect(stale.buttons.map(row => row.map(button => button.text))).toEqual([['➕ Нова гра']]);
            expect(receipt.text.split('\n')[0]).toBe('✅ Гру вже створено. Другого опитування немає.');
        })
    );
});
