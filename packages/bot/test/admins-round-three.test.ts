import { expect, layer } from '@effect/vitest';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Effect from 'effect/Effect';

import { conversation, pollsTo, walkManual } from './support/conversation';
import { advanceNow, setNow } from './support/fixed-clock';
import { gamesOn, grantOrganizer, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('two admins after the council', it => {
    it.effect('shows the game the other admin already posted instead of creating a second one', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('r3-two-admins', { groupChatId: -23_001, adminId: 2301 });
            yield* grantOrganizer(communityId, 2302);
            const first = conversation(recorder, adminNumbered(2301));
            const second = conversation(recorder, adminNumbered(2302, 'ru'));
            yield* first.type('/newgame');
            yield* second.type('/newgame');
            yield* first.tap('✅ Надіслати');
            yield* second.tap('✅ Отправить');
            const shown = second.screen();
            const games = yield* gamesOn(communityId, '2026-11-27');

            expect(games).toHaveLength(1);
            expect(pollsTo(recorder, -23_001)).toHaveLength(1);
            expect(shown.text.split('\n')[0]).toBe('Игра уже есть, второй опрос не отправлен.');
            expect(shown.text).toContain('📣 Опрос: «Games»');
        })
    );

    it.effect('checks the kickoff again at ✅ and refuses a time the clock change skips', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('r3-kickoff', { groupChatId: -27_001, adminId: 2701 });
            const admin = conversation(recorder, adminNumbered(2701));
            yield* admin.type('/newgame');
            yield* admin.type('26.11 10:15');
            yield* advanceNow(20 * 60_000);
            yield* admin.tap('✅ Надіслати');
            const late = admin.screen();
            yield* admin.type('/newgame');
            yield* admin.type('28.3.2027 2:30');
            yield* admin.tap('✅ Надіслати');
            const skipped = admin.screen();
            const today = yield* gamesOn(communityId, '2026-11-26');
            const spring = yield* gamesOn(communityId, '2027-03-28');

            expect(late.text.split('\n').at(-1)).toBe('⚠️ Час гри вже минув, нічого не надіслано. Обери інший час або день.');
            expect(skipped.text.split('\n').at(-1)).toBe('⚠️ Такого часу цього дня немає: годинник переводять. Обери інший час.');
            expect(today).toEqual([]);
            expect(spring).toEqual([]);
            expect(pollsTo(recorder, -27_001)).toEqual([]);
        })
    );

    it.effect('checks the stored kickoff again before posting the poll of an existing game', () =>
        Effect.gen(function* () {
            yield* seedSeason('r4-announce-kickoff', { groupChatId: -27_011, adminId: 2711 });
            const admin = conversation(recorder, adminNumbered(2711));
            yield* admin.type('/newgame');
            yield* walkManual(admin, ['🛠 З нуля', 'Сьогодні 26.11', 'Park Field', '18:30', '👥 18', '💾 Зберегти без опитування']);
            yield* setNow(Date.parse('2026-11-26T17:20:00Z'));
            yield* admin.type('/games');
            yield* admin.tap('Чт 26.11 18:30');
            yield* admin.tap('📣 Надіслати в «Games»');
            yield* advanceNow(15 * 60_000);
            yield* admin.tap('✅ Надіслати в «Games»');

            expect(pollsTo(recorder, -27_011)).toEqual([]);
            expect(admin.screen().text.split('\n')[0]).toBe('⚠️ Час гри вже минув, нічого не надіслано. Обери інший час або день.');
        })
    );
});
