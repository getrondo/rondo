import { expect, layer } from '@effect/vitest';
import { seedCommunity, seedConfig } from '@rondo/core/testing/seed-community';
import { venue } from '@rondo/db/schema/venue.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation, deliver, labelsOf, lastPollId, unknownCardPoll, walkManual } from './support/conversation';
import { advanceNow, setNow } from './support/fixed-clock';
import { grantOrganizer, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const lastPost = (chatId: number) =>
    String(recorder.calls.findLast(call => call.method === 'sendMessage' && call.payload.chat_id === chatId)?.payload.text);
const setAddress = (venueId: string, address: string) =>
    Effect.gen(function* () {
        const db = yield* Db;
        yield* db.update(venue).set({ address }).where(eq(venue.id, venueId));
    });

const voteIn = (chatId: number, id: number) =>
    deliver({
        poll_answer: {
            poll_id: lastPollId(recorder, chatId),
            user: { id, is_bot: false, first_name: `Player ${id}` },
            option_ids: [0],
            option_persistent_ids: []
        }
    });

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('design round three', it => {
    it.effect('says where a change or a cancellation went and puts the receipt under a notice sent to me', () =>
        Effect.gen(function* () {
            yield* seedSeason('r3-receipts', { groupChatId: -29_001, adminId: 2901 });
            const admin = conversation(recorder, adminNumbered(2901));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати');
            yield* voteIn(-29_001, 9_290_001);
            yield* admin.tap('🕖 Час');
            yield* admin.type('20:15');
            yield* admin.tap('✅ Змінити й написати в «Games»');
            const [loud] = admin.screen().text.split('\n');
            yield* admin.tap('👥 Ліміт');
            yield* admin.type('20');
            yield* admin.tap('Змінити, у групу не писати');
            const [quiet] = admin.screen().text.split('\n');
            yield* admin.tap('✖️ Скасувати гру');
            yield* admin.tap('Погода');
            yield* admin.tap('✅ Скасувати й написати в «Games»');
            const cancelled = admin.screen().text;

            yield* seedSeason('r3-receipts-me', { groupChatId: null, adminId: 2902 });
            const self = conversation(recorder, adminNumbered(2902, 'ru'));
            yield* self.type('/newgame');
            yield* self.tap('✅ Отправить опрос мне');
            yield* self.tap('✏️ Изменить');
            yield* self.tap('🕖 Время');
            yield* self.type('20:15');
            const confirmation = self.screen();
            yield* self.tap('✅ Изменить и прислать мне');
            const seen = self.seen();
            const notice = seen.findIndex(message => message.text.includes('20:15') && message.id > confirmation.id);
            const receipt = seen.at(-1);

            expect(loud).toBe('✅ Змінено, у «Games» написано.');
            expect(quiet).toBe('✅ Змінено. У групу нічого не надіслано.');
            expect(cancelled.split('\n')[0]).toBe('✅ Скасовано, у «Games» написано.');
            expect(cancelled).not.toContain('вільно');
            expect(notice).toBeGreaterThan(-1);
            expect(receipt?.id).toBeGreaterThan(seen[notice]?.id ?? Number.MAX_SAFE_INTEGER);
            expect(receipt?.text.split('\n')[0]).toBe('✅ Изменено. Сообщение выше перешли в группу: нажми и удерживай → Переслать.');
            expect(seen.find(message => message.id === confirmation.id)?.text).toBe('✅ Сообщение ниже 👇');
        })
    );

    it.effect('posts every change notice in one shape: what changed, from and to, and the address', () =>
        Effect.gen(function* () {
            const { park } = yield* seedSeason('r3-notice-shape', { groupChatId: -29_003, adminId: 2903 });
            yield* setAddress(park, 'Park Lane 5');
            const admin = conversation(recorder, adminNumbered(2903));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати');
            yield* admin.tap('🕖 Час');
            yield* admin.type('19:30');
            yield* admin.tap('✅ Змінити й написати в «Games»');
            const time = lastPost(-29_003);
            yield* admin.tap('📍 Місце');
            yield* admin.tap('Park Field');
            yield* admin.tap('✅ Змінити й написати в «Games»');
            const place = lastPost(-29_003);

            expect(time).toBe('<b>📢 Зміни</b>\n<b>Пт 27.11 · North Arena</b>\n🕐 Час: 19:00 → 19:30');
            expect(place).toBe('<b>📢 Зміни</b>\n<b>Пт 27.11 · North Arena</b>\n📍 Місце: North Arena → Park Field\n📍 <b>Park Lane 5</b>');
        })
    );

    it.effect('labels the preview, the lists, the wizard and the card the way the design council asked', () =>
        Effect.gen(function* () {
            yield* seedSeason('r3-labels', { groupChatId: -29_004, adminId: 2904 });
            const admin = conversation(recorder, adminNumbered(2904));
            yield* admin.type('/newgame');
            const preview = admin.screen();
            yield* admin.tap('📤 Куди');
            const where = admin.screen().text;
            yield* admin.tap('⬅️ Назад');
            yield* admin.tap('📍 North Arena');
            const places = admin.labels().flat();
            yield* admin.tap('⬅️ Назад');
            yield* walkManual(admin, ['🛠 З нуля', 'Сб 28.11', 'Park Field', '18:30']);
            const size = admin.screen();
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати');
            const card = admin.labels().flat();
            yield* setNow(Date.parse('2026-11-26T22:30:00Z'));
            yield* admin.type('/newgame');
            yield* admin.type('23:40');
            yield* admin.tap('📅 Пн 30.11');
            yield* admin.tap('Сьогодні 26.11');
            yield* advanceNow(20 * 60 * 1000);
            yield* admin.tap('🕖 23:40');
            const late = admin.screen().text;
            const fresh = yield* seedCommunity(seedConfig('r3-labels-fresh'));
            yield* grantOrganizer(fresh.communityId, 2905);
            const newcomer = conversation(recorder, adminNumbered(2905));
            yield* newcomer.type('/newgame');
            const firstStep = newcomer.labels().flat();

            expect(preview.buttons.some(row => row.length === 1 && row[0]?.text === '📝 Рядок')).toBe(true);
            expect(labelsOf(preview)).toContain('↔️ Інша: Пн 30.11 18:30 · Park Fi…');
            expect(preview.text).toContain('↔️ Інша гра: Пн 30.11 18:30 · Park Field');
            expect(preview.text).toContain('💡 Або напиши: пн 19:30, 18 місць');
            expect(where).toContain('📤 Куди надіслати опитування?');
            expect(places).toContain('📍 Адреса для «North Arena»');
            expect(firstStep.at(-1)).toBe('🏠 Меню');
            expect(size.buttons[0]?.map(button => button.text)).toEqual(['−1', '👥 18', '+1']);
            expect(size.text).not.toContain('Число полів');
            expect(card).toContain('🗑 Видалити гру');
            expect(late.split('\n').at(-1)).toBe('Сьогодні для звичних годин уже пізно.');
        })
    );

    it.effect('offers one text and one ✅ button after an unknown poll send on the card', () =>
        Effect.gen(function* () {
            yield* seedSeason('r3-unknown-card', { groupChatId: -29_006, adminId: 2906 });
            const admin = conversation(recorder, adminNumbered(2906));
            yield* admin.type('/newgame');
            yield* unknownCardPoll(recorder, admin);
            const unknown = admin.screen();
            yield* admin.tap('📣 Немає, надіслати в «Games»');
            const confirmation = admin.screen();
            yield* admin.tap('✅ Надіслати в «Games»');
            const sent = admin.screen();

            expect(unknown.text.split('\n')[0]).toBe(
                '⚠️ Не знаю, чи дійшло опитування в «Games». Зазирни туди. Немає — натисни ✅ нижче. Є — спершу видали його там: я його не бачу й голоси не порахую.'
            );
            expect(labelsOf(unknown).filter(label => label.includes('Games'))).toEqual(['📣 Немає, надіслати в «Games»']);
            expect(confirmation.text.split('\n')[0]).toBe('Так буде в «Games»:');
            expect(sent.text.split('\n')[0]).toBe('✅ Опитування в «Games».');
        })
    );
});
