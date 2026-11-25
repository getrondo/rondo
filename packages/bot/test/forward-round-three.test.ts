import { expect, layer } from '@effect/vitest';
import { bindChat } from '@rondo/core/community/community.repository';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Effect from 'effect/Effect';

import { conversation, labelsOf } from './support/conversation';
import { seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const forwardsTo = (chatId: number) => recorder.calls.filter(call => call.method === 'forwardMessage' && call.payload.chat_id === chatId);

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('forwards after the council', it => {
    it.effect('keeps one claim per group after an unknown forward and sends again only after the admin says it is not there', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('r3-forward', { groupChatId: -24_001, adminId: 2401 });
            const admin = conversation(recorder, adminNumbered(2401));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати');
            yield* bindChat({ communityId, chatId: -24_002n, topicId: null, kind: 'supergroup', title: 'Second' });
            yield* admin.type('/games');
            yield* admin.tap('Пт 27.11 19:00');
            yield* admin.tap('📣 Надіслати ще в «Second»');
            const confirmation = admin.screen();
            recorder.failures.set('forwardMessage', new Error('socket hang up'));
            yield* admin.tapOn(confirmation, '✅ Надіслати в «Second»');
            recorder.failures.delete('forwardMessage');
            const unknown = admin.screen();
            yield* admin.type('/games');
            yield* admin.tap('Пт 27.11 19:00');
            const card = admin.screen();
            const afterUnknown = forwardsTo(-24_002).length;
            yield* admin.tap('✅ Немає, надіслати в «Second»');
            const resent = admin.screen();

            expect(unknown.text.split('\n')[0]).toBe(
                '⚠️ Не знаю, чи дійшло опитування в «Second». Зазирни туди. Немає — натисни ✅ нижче. Є — нічого не роби: голоси з нього рахуються.'
            );
            expect(labelsOf(unknown)).toContain('✅ Немає, надіслати в «Second»');
            expect(labelsOf(card)).toContain('✅ Немає, надіслати в «Second»');
            expect(labelsOf(card)).not.toContain('📣 Надіслати ще в «Second»');
            expect(afterUnknown).toBe(1);
            expect(forwardsTo(-24_002)).toHaveLength(2);
            expect(resent.text.split('\n')[0]).toBe('✅ Опитування тепер і в «Second».');
            expect(labelsOf(resent).some(label => label.includes('Second'))).toBe(false);
        })
    );
});
