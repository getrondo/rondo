import { expect, layer } from '@effect/vitest';
import { grantAdmin } from '@rondo/core/access/admin-access';
import { bindChat } from '@rondo/core/community/community.repository';
import { upsertTelegramUser } from '@rondo/core/identity/telegram-user';
import { createSession } from '@rondo/core/sessions/session.service';
import { seedCommunity, seedConfig } from '@rondo/core/testing/seed-community';
import { venue } from '@rondo/db/schema/venue.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder, refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation, keyboardOf, labelsOf } from './support/conversation';
import { gamesOn, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const pollTo = (chatId: number) => recorder.calls.findLast(call => call.method === 'sendPoll' && call.payload.chat_id === chatId);

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('/newgame, the rest of the paths', it => {
    it.effect('picks another day from the list, sets no limit, types the size and refuses a time that has passed today', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('more-day', { groupChatId: -5001, adminId: 801 });
            const admin = conversation(recorder, adminNumbered(801));
            yield* admin.type('/newgame');
            yield* admin.tap('📅 Пт 27.11');
            const days = admin.labels().flat();
            yield* admin.tap('Сб 28.11');
            yield* admin.tap('👥 22');
            yield* admin.tap('♾ Без ліміту');
            const limitless = admin.screen();
            yield* admin.tap('👥 ♾');
            yield* admin.type('25');
            yield* admin.tap('📅 Сб 28.11');
            yield* admin.type('26.11');
            yield* admin.tap('🕖 19:00');
            yield* admin.type('08:00');
            const refused = admin.screen().text;
            yield* admin.type('21:00');
            yield* admin.tap('✅ Надіслати');
            const [game] = yield* gamesOn(communityId, '2026-11-26');

            expect(days.slice(0, 3)).toEqual(['✓ Пт 27.11', 'Сб 28.11', 'Нд 29.11']);
            expect(days).toContain('Сьогодні 26.11');
            expect(limitless.text.split('</blockquote>')[0]).not.toContain('місць');
            expect(limitless.buttons[1]?.map(button => button.text)).toEqual(['−1', '👥 ♾', '+1']);
            expect(refused).toContain('вже минув');
            expect(game).toMatchObject({ capacityMax: 25 });
        })
    );

    it.effect('creates a new place from a Google Maps link', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedSeason('more-link', { groupChatId: -5002, adminId: 802 });
            const admin = conversation(recorder, adminNumbered(802));
            yield* admin.type('/newgame');
            yield* admin.tap('📍 North Arena');
            yield* admin.tap('➕ Нове місце');
            yield* admin.type('Lake Court');
            yield* admin.type('https://www.google.com/maps/place/Lake/@48.21,16.37,17z');
            yield* admin.tap('✅ Надіслати');
            const [stored] = yield* db
                .select()
                .from(venue)
                .where(and(eq(venue.communityId, communityId), eq(venue.name, 'Lake Court')));

            expect(stored).toMatchObject({
                lat: 48.21,
                lng: 16.37,
                mapUrl: 'https://www.google.com/maps/place/Lake/@48.21,16.37,17z',
                kind: 'training'
            });
            expect(pollTo(-5002)?.payload.reply_markup).toEqual({
                inline_keyboard: [[{ text: '🗺 Маршрут', url: 'https://www.google.com/maps/search/?api=1&query=48.21,16.37' }]]
            });
        })
    );

    it.effect('adds the missing address from the preview hint and shows it in the poll', () =>
        Effect.gen(function* () {
            yield* seedSeason('more-address', { groupChatId: -5003, adminId: 803 });
            const admin = conversation(recorder, adminNumbered(803));
            yield* admin.type('/newgame');
            yield* admin.tap('📍 North Arena');
            const hinted = admin.labels().flat();
            yield* admin.tap('📍 Адреса для «North Arena»');
            yield* admin.type('Main Street 1 (gate B)');
            const preview = admin.screen();
            yield* admin.tap('✅ Надіслати');

            expect(hinted).toContain('📍 Адреса для «North Arena»');
            expect(preview.text).toContain('Main Street 1 (gate B)');
            expect(pollTo(-5003)?.payload.description).toBe('📍 <b>Main Street 1 (gate B)</b>');
        })
    );

    it.effect('warns about a game on the same day and offers the poll of a game without one', () =>
        Effect.gen(function* () {
            const { communityId, north } = yield* seedSeason('more-existing', { groupChatId: -5004, adminId: 804 });
            yield* createSession({
                communityId,
                timezone: 'Europe/Vienna',
                localDate: '2026-11-27',
                localTime: '19:00',
                venueId: north,
                capacityMax: 22,
                title: null,
                actorPersonId: null
            });
            const admin = conversation(recorder, adminNumbered(804));
            yield* admin.type('/newgame');
            const announce = admin.screen();
            yield* admin.tap('↔️ ');
            yield* admin.tap('📅 Пн 30.11');
            yield* admin.tap('Пт 27.11');
            const duplicate = admin.screen().text;
            yield* admin.tap('🏠 Меню');
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати');
            const games = yield* gamesOn(communityId, '2026-11-27');

            expect(announce.text).toContain('Гра вже є, опитування ще немає');
            expect(announce.buttons.map(row => row.map(button => button.text))).toEqual([
                ['✅ Надіслати в «Games»'],
                ['↔️ Інша: Пн 30.11 18:30 · Park Fi…'],
                ['📤 Куди', '🛠 З нуля', '🏠 Меню']
            ]);
            expect(duplicate).toContain('На цей день уже є гра: Пт 27.11');
            expect(games).toHaveLength(1);
            expect(pollTo(-5004)).toBeDefined();
        })
    );

    it.effect('starts with the manual steps when there is too little history', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedCommunity(seedConfig('more-empty'));
            yield* bindChat({ communityId, chatId: -5005n, topicId: null, kind: 'supergroup', title: 'Games' });
            const personId = yield* upsertTelegramUser({ id: 805n, firstName: 'Admin 805' });
            yield* grantAdmin({ communityId, personId, grantedBy: null });
            const admin = conversation(recorder, adminNumbered(805));
            yield* admin.type('/newgame');

            expect(admin.screen().text).toContain('Поки замало історії');
            expect(admin.labels().flat()).toEqual(expect.arrayContaining(['Пт 27.11', '🏠 Меню']));
        })
    );

    it.effect('reports an uncertain poll when Telegram does not answer and keeps the game when pinning is refused', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('more-uncertain', { groupChatId: -5006, adminId: 806 });
            const admin = conversation(recorder, adminNumbered(806));
            yield* admin.type('/newgame');
            recorder.failures.set('sendPoll', new Error('socket hang up'));
            yield* admin.tap('✅ Надіслати');
            recorder.failures.delete('sendPoll');
            const uncertain = admin.screen();
            recorder.failures.set('pinChatMessage', refusal('pinChatMessage', 'Bad Request: not enough rights to pin a message'));
            yield* admin.tap('✅ Немає, надіслати в «Games»');
            recorder.failures.delete('pinChatMessage');
            const games = yield* gamesOn(communityId, '2026-11-27');

            expect(uncertain.text.split('\n').at(-1)).toBe(
                '⚠️ Не знаю, чи дійшло опитування в «Games». Зазирни туди. Немає — натисни ✅ нижче. Є — спершу видали його там: я його не бачу й голоси не порахую.'
            );
            expect(uncertain.text).not.toContain('нічого не надіслано');
            expect(uncertain.buttons[0]?.map(button => button.text)).toEqual(['✅ Немає, надіслати в «Games»']);
            expect(games).toHaveLength(1);
            expect(admin.screen().text).toContain('✅ Гру створено');
        })
    );

    it.effect('shows the same question, description and route in the preview as in the poll', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { north } = yield* seedSeason('more-same', { groupChatId: -5007, adminId: 807 });
            yield* db.update(venue).set({ address: 'Arena Way 2', lat: 48.3, lng: 16.5, station: 'U2 Stadium' }).where(eq(venue.id, north));
            const admin = conversation(recorder, adminNumbered(807));
            yield* admin.type('/newgame');
            const preview = admin.screen().text;
            yield* admin.tap('✅ Надіслати');
            const poll = pollTo(-5007)?.payload;
            const route = keyboardOf(poll?.reply_markup)[0]?.[0]?.url ?? '';

            expect(preview).toContain(`<blockquote>${String(poll?.question)}\n\n`);
            expect(preview).toContain('▫️ ✅ Граю\n▫️ ❌ Не граю</blockquote>');
            expect(preview).toContain(String(poll?.description));
            expect(preview).toContain(route.replaceAll('&', '&amp;'));
            expect(poll?.question).toContain('U2 Stadium');
            expect(poll?.description).toBe(
                '📍 <a href="https://www.google.com/maps/search/?api=1&amp;query=48.3,16.5"><b>Arena Way 2</b></a>'
            );
            expect(preview).not.toContain('🗺 Маршрут');
        })
    );

    it.effect('hands text that is not a value to the assistant while a list is open', () =>
        Effect.gen(function* () {
            yield* seedSeason('more-text', { groupChatId: -5008, adminId: 808 });
            const admin = conversation(recorder, adminNumbered(808));
            yield* admin.type('/newgame');
            yield* admin.tap('📅 Пт 27.11');
            const list = admin.screen();
            yield* admin.type('хто грав найчастіше?');
            const [reply, again] = admin.seen().slice(-2);
            yield* admin.tap('Пн 30.11');

            expect(reply?.text).toBe('Не зрозумів текст, нічого не надіслано. Напиши, наприклад: пн 19:30 18, або збери кнопками.');
            expect(labelsOf(again ?? { buttons: [] })).toEqual(labelsOf(list));
            expect(admin.screen().text).toContain('⚽ Понеділок, 30 листопада');
        })
    );
});
