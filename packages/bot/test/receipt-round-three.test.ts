import { expect, layer } from '@effect/vitest';
import { makeRecorder, refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Effect from 'effect/Effect';

import { conversation } from './support/conversation';
import { gamesOn, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const broken = ['editMessageText', 'sendMessage'];

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('receipts after the council', it => {
    it.effect('never says nothing was sent when the screen after a sent poll could not be shown', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('r3-receipt', { groupChatId: null, adminId: 2801 });
            const admin = conversation(recorder, adminNumbered(2801));
            yield* admin.type('/newgame');
            const preview = admin.screen();
            for (const method of broken) {
                recorder.failures.set(method, refusal(method, 'Bad Request: message to edit not found'));
            }
            yield* admin.tapOn(preview, '✅ Надіслати опитування мені').pipe(Effect.exit);
            for (const method of broken) {
                recorder.failures.delete(method);
            }
            yield* admin.tapOn(preview, '✅ Надіслати опитування мені');
            const after = admin.screen();
            const games = yield* gamesOn(communityId, '2026-11-27');

            expect(games).toHaveLength(1);
            expect(after.text).not.toContain('нічого не надіслано');
            expect(after.text.split('\n')[0]).toBe('✅ Гру вже створено. Другого опитування немає.');
        })
    );
});
