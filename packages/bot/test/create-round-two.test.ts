import { expect, layer } from '@effect/vitest';
import { createSession } from '@rondo/core/sessions/session.service';
import { venue } from '@rondo/db/schema/venue.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation, labelsOf } from './support/conversation';
import { advanceNow, setNow } from './support/fixed-clock';
import { gamesOn, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const hint = '💡 Або напиши: пн 19:30, 18 місць';

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('/newgame after the second design round', it => {
    it.effect('steps back one step at a time, keeps a typed place name and adds a new place in six taps', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedSeason('r2-back', { groupChatId: -19_001, adminId: 1901 });
            const admin = conversation(recorder, adminNumbered(1901));
            yield* admin.type('/newgame');
            yield* admin.tap('🛠 З нуля');
            yield* admin.tap('Сб 28.11');
            yield* admin.tap('⬅️ Назад');
            const day = admin.screen().text;
            yield* admin.tap('Сб 28.11');
            yield* admin.tap('Park Field');
            yield* admin.tap('⬅️ Назад');
            const place = admin.screen().text;
            const before = recorder.calls.filter(call => call.method === 'answerCallbackQuery').length;
            yield* admin.type('/newgame');
            yield* admin.tap('📍 North Arena');
            yield* admin.tap('➕ Нове місце');
            yield* admin.type('Quarry Court');
            const offered = admin.labels();
            yield* admin.tap('⬅️ Назад');
            const kept = admin.screen();
            yield* admin.tap('✅ Надіслати');
            const taps = recorder.calls.filter(call => call.method === 'answerCallbackQuery').length - before;
            const [game] = yield* gamesOn(communityId, '2026-11-27');
            const [quarry] = yield* db.select({ id: venue.id }).from(venue).where(eq(venue.name, 'Quarry Court'));

            expect(day).toContain('📅 Який день?');
            expect(place).toContain('📍 Де граємо?');
            expect(kept.text).toContain('Quarry Court');
            expect(labelsOf(kept)).toContain('📍 Quarry Court');
            expect(offered).toEqual([['⏭ Пропустити'], ['⬅️ Назад']]);
            expect(taps + 1).toBeLessThanOrEqual(6);
            expect(game?.venueId).toBe(quarry?.id);
        })
    );

    it.effect('keeps a short toast and a reassuring message on an expired screen and offers another day when no time is left today', () =>
        Effect.gen(function* () {
            yield* seedSeason('r2-late', { groupChatId: -19_002, adminId: 1902 });
            const admin = conversation(recorder, adminNumbered(1902));
            yield* admin.type('/newgame');
            const old = admin.screen();
            yield* advanceNow(31 * 60 * 1000);
            yield* admin.tapOn(old, '+1');
            const toast = recorder.calls.findLast(call => call.method === 'answerCallbackQuery');
            const expired = admin.screen();
            yield* setNow(Date.parse('2026-11-26T22:30:00Z'));
            yield* admin.type('/newgame');
            yield* admin.type('23:40');
            yield* admin.tap('📅 Пт 27.11');
            yield* admin.tap('Сьогодні 26.11');
            yield* advanceNow(20 * 60 * 1000);
            yield* admin.tap('🕖 23:40');

            expect(toast?.payload.text).toBe('Екран застарів');
            expect(expired).toEqual({ id: old.id, text: '⌛ Цей екран застарів, нічого не надіслано.', buttons: expired.buttons });
            expect(labelsOf(expired)).toEqual(['➕ Нова гра']);
            expect(admin.labels()).toEqual([['📅 Інший день'], ['⬅️ Назад']]);
        })
    );

    it.effect('names the other likely game in full when its button cannot hold it and adds a poll line from the preview', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { park } = yield* seedSeason('r2-long', { groupChatId: -19_003, adminId: 1903 });
            yield* db.update(venue).set({ name: 'Riverside Community Sports Ground' }).where(eq(venue.id, park));
            const admin = conversation(recorder, adminNumbered(1903));
            yield* admin.type('/newgame');
            const preview = admin.screen();
            yield* admin.tap('📝 Рядок');
            const ask = admin.screen().text;
            yield* admin.type('Bring a dark and a light shirt');
            yield* admin.tap('✅ Надіслати');
            const poll = recorder.calls.findLast(call => call.method === 'sendPoll' && call.payload.chat_id === -19_003);

            expect(preview.text).toContain('↔️ Інша гра: Пн 30.11 18:30 · Riverside Community Sports Ground');
            expect(
                labelsOf(preview)
                    .find(label => label.startsWith('↔️'))
                    ?.endsWith('…')
            ).toBe(true);
            expect(ask).toContain('📝 Напиши рядок, він стане в кінець опитування.');
            expect(JSON.stringify(poll?.payload)).toContain('Bring a dark and a light shirt');
        })
    );

    it.effect('answers a repeated ✅ for an existing game without claiming it was created', () =>
        Effect.gen(function* () {
            const { communityId, north } = yield* seedSeason('r2-existing', { groupChatId: -19_004, adminId: 1904 });
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
            const admin = conversation(recorder, adminNumbered(1904));
            yield* admin.type('/newgame');
            const announce = admin.screen();
            yield* admin.tapOn(announce, '✅ Надіслати в «Games»');
            yield* admin.tapOn(announce, '✅ Надіслати в «Games»');

            expect(announce.text).not.toContain(hint);
            expect(admin.screen().text.split('\n')[0]).toBe('✅ Уже зроблено.');
        })
    );

    it.effect('shows the typing hint until the admin has created three games', () =>
        Effect.gen(function* () {
            yield* seedSeason('r2-hint', { groupChatId: -19_005, adminId: 1905 });
            const admin = conversation(recorder, adminNumbered(1905));
            const round = Effect.gen(function* () {
                yield* admin.type('/newgame');
                const { text } = admin.screen();
                yield* admin.tap('✅ Надіслати');

                return text.includes(hint);
            });
            const shown = yield* Effect.all([round, round, round, round]);

            expect(shown).toEqual([true, true, true, false]);
        })
    );
});
