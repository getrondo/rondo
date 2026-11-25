import { expect, layer } from '@effect/vitest';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Effect from 'effect/Effect';

import { conversation } from './support/conversation';
import { advanceNow } from './support/fixed-clock';
import { gamesOn, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const pollsTo = (chatId: number) => recorder.calls.filter(call => call.method === 'sendPoll' && call.payload.chat_id === chatId);

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('kickoff checks after the council', it => {
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
            expect(pollsTo(-27_001)).toEqual([]);
        })
    );
});
