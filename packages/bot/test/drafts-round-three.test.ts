import { expect, layer } from '@effect/vitest';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Effect from 'effect/Effect';

import { conversation } from './support/conversation';
import { seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('drafts after the council', it => {
    it.effect('keeps a live draft when a menu button on an older message is tapped', () =>
        Effect.gen(function* () {
            yield* seedSeason('r3-old-menu', { groupChatId: -20_001, adminId: 2001 });
            const admin = conversation(recorder, adminNumbered(2001));
            yield* admin.type('/start');
            const start = admin.screen();
            yield* admin.type('/newgame');
            const draft = admin.screen();
            yield* admin.tapOn(start, '📅 Ігри');
            yield* admin.tapOn(draft, '+1');
            const stepped = recorder.calls.findLast(call => call.method === 'editMessageText' && call.payload.message_id === draft.id);

            expect(String(stepped?.payload.text)).toContain('Опитування буде таким:');
            expect(JSON.stringify(stepped?.payload.reply_markup)).toContain('👥 23');
        })
    );
});
