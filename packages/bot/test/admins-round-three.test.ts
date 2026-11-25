import { expect, layer } from '@effect/vitest';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Effect from 'effect/Effect';

import { conversation } from './support/conversation';
import { gamesOn, grantOrganizer, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const pollsTo = (chatId: number) => recorder.calls.filter(call => call.method === 'sendPoll' && call.payload.chat_id === chatId);

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
            expect(pollsTo(-23_001)).toHaveLength(1);
            expect(shown.text.split('\n')[0]).toBe('Игра уже есть, второй опрос не отправлен.');
            expect(shown.text).toContain('📣 Опрос: «Games»');
        })
    );
});
