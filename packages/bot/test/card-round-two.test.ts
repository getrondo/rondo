import { expect, layer } from '@effect/vitest';
import { venue } from '@rondo/db/schema/venue.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation, labelsOf } from './support/conversation';
import { gamesOn, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const postsIn = (chatId: number) => recorder.calls.filter(call => call.method === 'sendMessage' && call.payload.chat_id === chatId);

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('game card after the second design round', it => {
    it.effect('puts the new limit inside the group notice and says the players learn from it', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('r2-limit', { groupChatId: -18_001, adminId: 1801 });
            const admin = conversation(recorder, adminNumbered(1801));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати');
            const card = admin.screen();
            yield* admin.tap('👥 Ліміт');
            const sizes = admin.labels();
            yield* admin.type('20');
            const ask = admin.screen();
            yield* admin.tap('✅ Змінити й написати в «Games»');
            const notice = String(postsIn(-18_001).at(-1)?.payload.text);
            const [game] = yield* gamesOn(communityId, '2026-11-27');

            expect(card.text).toContain('Поки ніхто не записався · 22 місця');
            expect(card.text).not.toContain('📣 Опитування:');
            expect(sizes[0]).toEqual(['−1', '👥 22', '+1']);
            expect(ask.text).toMatch(/<blockquote>[\s\S]*👥 Місць: 22 → 20[\s\S]*<\/blockquote>/u);
            expect(ask.text.split('\n').at(-1)).toBe(
                'Опитування в чаті не зміниться, там залишиться старе число місць. Гравці дізнаються з цього повідомлення.'
            );
            expect(labelsOf(ask)).toEqual(['✅ Змінити й написати в «Games»', 'Змінити, у групу не писати', '⬅️ Назад']);
            expect(notice).toContain('👥 Місць: 22 → 20');
            expect(game).toMatchObject({ capacityMax: 20 });
        })
    );

    it.effect('speaks of my chat, not a group, for a game kept with me, in Russian', () =>
        Effect.gen(function* () {
            yield* seedSeason('r2-mine', { groupChatId: null, adminId: 1802 });
            const admin = conversation(recorder, adminNumbered(1802, 'ru'));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Отправить опрос мне');
            yield* admin.tap('✏️ Изменить');
            yield* admin.tap('🕖 Время');
            yield* admin.tap('19:30');
            const change = admin.screen();
            yield* admin.tap('⬅️ Назад');
            yield* admin.tap('✖️ Отменить игру');
            yield* admin.tap('Погода');
            const cancel = admin.screen();

            expect(change.text.split('\n')[0]).toBe('Пришлю тебе, а ты перешлёшь в группу:');
            expect(change.text).toContain('Опрос в чате не изменится, там останется старое время.');
            expect(change.text).not.toContain('Игроки узнают');
            expect(labelsOf(change)).toEqual(['✅ Изменить и прислать мне', 'Изменить без сообщения', '⬅️ Назад']);
            expect(labelsOf(cancel)).toEqual(['✅ Отменить и прислать мне', 'Отменить игру без сообщения', '⬅️ Назад']);
        })
    );

    it.effect('accepts a typed date, time and limit on the card with the same warnings and offers every place with a new one', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedSeason('r2-typed-card', { groupChatId: -18_003, adminId: 1803 });
            const admin = conversation(recorder, adminNumbered(1803));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати');
            yield* admin.tap('📅 День');
            const days = admin.labels().flat();
            yield* admin.type('20.11.2026');
            const past = admin.screen().text;
            yield* admin.type('5.12');
            const moved = admin.screen().text;
            yield* admin.tap('⬅️ Назад');
            yield* admin.tap('🕖 Час');
            yield* admin.type('25:00');
            const badTime = admin.screen().text;
            yield* admin.tap('⬅️ Назад');
            yield* admin.tap('👥 Ліміт');
            yield* admin.type('120');
            const badLimit = admin.screen().text;
            yield* admin.tap('⬅️ Назад');
            yield* admin.tap('📍 Місце');
            const places = admin.labels();
            yield* admin.tap('➕ Нове місце');
            yield* admin.type('Quarry Court');
            yield* admin.tap('Змінити, у групу не писати');
            const [game] = yield* gamesOn(communityId, '2026-11-27');
            const [quarry] = yield* db.select({ id: venue.id }).from(venue).where(eq(venue.name, 'Quarry Court'));

            expect(days.slice(-3)).toEqual(['Сьогодні 26.11', '⬅️ Назад', '🏠 Меню']);
            expect(past.split('\n').at(-1)).toBe('⚠️ Ця дата вже минула. Обери день нижче або напиши, напр. 5.12.');
            expect(moved).toContain('➡️ <b>Сб 05.12 19:00 · North Arena</b>');
            expect(badTime.split('\n').at(-1)).toBe('⚠️ Не зрозумів час. Напиши, напр. 18:45.');
            expect(badLimit.split('\n').at(-1)).toBe('⚠️ Напиши число від 1 до 99.');
            expect(places).toEqual([['Park Field'], ['➕ Нове місце'], ['⬅️ Назад', '🏠 Меню']]);
            expect(game?.venueId).toBe(quarry?.id);
        })
    );

    it.effect('lays the card out in a grid with teams alone, cancel and delete on their own rows and capitalised reasons', () =>
        Effect.gen(function* () {
            yield* seedSeason('r2-grid', { groupChatId: -18_004, adminId: 1804 });
            const admin = conversation(recorder, adminNumbered(1804));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати');
            const created = admin.screen();
            yield* admin.tap('✖️ Скасувати гру');
            const reasons = admin.labels();

            expect(labelsOf(created)).toEqual([
                '🕖 Час',
                '📅 День',
                '📍 Місце',
                '👥 Ліміт',
                '✖️ Скасувати гру',
                '🗑 Видалити',
                '⬅️ Назад',
                '🏠 Меню'
            ]);
            expect(created.buttons.map(row => row.length)).toEqual([2, 2, 1, 1, 2]);
            expect(reasons.flat().slice(0, 2)).toEqual(['Погода', 'Мало гравців']);
        })
    );
});
