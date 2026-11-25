import { expect, layer } from '@effect/vitest';
import { bindChat } from '@rondo/core/community/community.repository';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Effect from 'effect/Effect';

import { conversation, labelsOf, pollsTo, walkManual } from './support/conversation';
import { seedSecondGroup, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const forwardsTo = (chatId: number) => recorder.calls.filter(call => call.method === 'forwardMessage' && call.payload.chat_id === chatId);
const changed = '⚠️ Дані змінилися, нічого не надіслано. Переглянь ще раз і натисни ✅.';
const saveManual = ['🛠 З нуля', 'Сб 28.11', 'Park Field', '18:30', '👥 18', '💾 Зберегти без опитування'];

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('previewed chats and topics', it => {
    it.effect('posts a card poll only to the previewed chat and topic and shows a fresh preview after a move', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('r4-card-topic', { groupChatId: -28_001, adminId: 2801 });
            const admin = conversation(recorder, adminNumbered(2801));
            yield* admin.type('/newgame');
            yield* walkManual(admin, saveManual);
            yield* admin.tap('📣 Надіслати в «Games»');
            yield* bindChat({ communityId, chatId: -28_001n, topicId: 9, kind: 'supergroup', title: 'Games' });
            yield* admin.tap('✅ Надіслати в «Games»');
            const fresh = admin.screen();
            const before = pollsTo(recorder, -28_001).length;
            yield* admin.tap('✅ Надіслати в «Games»');

            expect(before).toBe(0);
            expect(fresh.text.split('\n')[0]).toBe(changed);
            expect(pollsTo(recorder, -28_001).map(call => call.payload.message_thread_id)).toEqual([9]);
        })
    );

    it.effect('forwards from the card and after /newgame only to the previewed topic of the other group', () =>
        Effect.gen(function* () {
            const { communityId, north } = yield* seedSeason('r4-forward-topic', { groupChatId: -28_011, adminId: 2802 });
            yield* seedSecondGroup(communityId, { main: -28_011, second: -28_012, venueId: north });
            const admin = conversation(recorder, adminNumbered(2802));
            yield* admin.type('/newgame');
            yield* admin.tap('📤 Куди');
            yield* admin.tap('«Games» і «Second»');
            yield* bindChat({ communityId, chatId: -28_012n, topicId: 6, kind: 'supergroup', title: 'Second' });
            yield* admin.tap('✅ Надіслати в обидві групи');
            const result = admin.screen().text;
            const afterNewGame = forwardsTo(-28_012).length;
            yield* admin.tap('📣 Надіслати ще в «Second»');
            yield* bindChat({ communityId, chatId: -28_012n, topicId: 7, kind: 'supergroup', title: 'Second' });
            yield* admin.tap('✅ Надіслати в «Second»');
            const fresh = admin.screen();
            const afterCard = forwardsTo(-28_012).length;
            yield* admin.tap('✅ Надіслати в «Second»');

            expect(afterNewGame).toBe(0);
            expect(result).toContain('«Second»');
            expect(afterCard).toBe(0);
            expect(fresh.text.split('\n')[0]).toBe(changed);
            expect(forwardsTo(-28_012).map(call => call.payload.message_thread_id)).toEqual([7]);
        })
    );

    it.effect('opens the normal confirmation from the button after an unknown poll send on the card', () =>
        Effect.gen(function* () {
            yield* seedSeason('r4-retry-confirm', { groupChatId: -28_021, adminId: 2803 });
            const admin = conversation(recorder, adminNumbered(2803));
            yield* admin.type('/newgame');
            yield* walkManual(admin, saveManual);
            yield* admin.tap('📣 Надіслати в «Games»');
            recorder.failures.set('sendPoll', new Error('socket hang up'));
            yield* admin.tap('✅ Надіслати в «Games»');
            recorder.failures.delete('sendPoll');
            const unknown = admin.screen();
            yield* admin.tap('📣 Немає, надіслати в «Games»');
            const confirmation = admin.screen();

            expect(labelsOf(unknown)).toContain('📣 Немає, надіслати в «Games»');
            expect(pollsTo(recorder, -28_021)).toHaveLength(1);
            expect(confirmation.text.split('\n')[0]).toBe('Так буде в «Games»:');
            expect(labelsOf(confirmation)[0]).toBe('✅ Надіслати в «Games»');
        })
    );
});
