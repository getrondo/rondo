import { expect, layer } from '@effect/vitest';
import { linkGroup } from '@rondo/core/testing/link-group';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation, forwardsTo, pollsTo, unknownCardPoll, walkManual } from './support/conversation';
import { seedSecondGroup, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
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
            yield* linkGroup(communityId, { chatId: -28_001, title: 'Games', topicId: 9 });
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
            yield* linkGroup(communityId, { chatId: -28_012, title: 'Second', topicId: 6, purpose: 'other' });
            yield* admin.tap('✅ Надіслати в обидві групи');
            const result = admin.screen().text;
            const afterNewGame = forwardsTo(recorder, -28_012).length;
            yield* admin.tap('📣 Надіслати ще в «Second»');
            yield* linkGroup(communityId, { chatId: -28_012, title: 'Second', topicId: 7, purpose: 'other' });
            yield* admin.tap('✅ Надіслати в «Second»');
            const fresh = admin.screen();
            const afterCard = forwardsTo(recorder, -28_012).length;
            yield* admin.tap('✅ Надіслати в «Second»');

            expect(afterNewGame).toBe(0);
            expect(result).toContain('«Second»');
            expect(afterCard).toBe(0);
            expect(fresh.text.split('\n')[0]).toBe(changed);
            expect(forwardsTo(recorder, -28_012).map(call => call.payload.message_thread_id)).toEqual([7]);
        })
    );

    it.effect('posts the card poll only as it was previewed and shows a fresh preview when the game changed', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedSeason('r5-card-summary', { groupChatId: -28_031, adminId: 2804 });
            const admin = conversation(recorder, adminNumbered(2804));
            yield* admin.type('/newgame');
            yield* walkManual(admin, saveManual);
            yield* admin.tap('📣 Надіслати в «Games»');
            yield* db.update(session).set({ capacityMax: 30 }).where(eq(session.communityId, communityId));
            yield* admin.tap('✅ Надіслати в «Games»');
            const fresh = admin.screen();

            expect(pollsTo(recorder, -28_031)).toEqual([]);
            expect(fresh.text.split('\n')[0]).toBe(changed);
            expect(fresh.text).toContain('30');
        })
    );

    it.effect('retries an unknown card poll only to the chat and topic of the first attempt', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('r5-retry-topic', { groupChatId: -28_041, adminId: 2805 });
            const admin = conversation(recorder, adminNumbered(2805));
            yield* admin.type('/newgame');
            yield* unknownCardPoll(recorder, admin);
            yield* linkGroup(communityId, { chatId: -28_041, title: 'Games', topicId: 8 });
            yield* admin.tap('📣 Немає, надіслати в «Games»');
            yield* admin.tap('✅ Надіслати в «Games»');
            const fresh = admin.screen();
            const afterFirst = pollsTo(recorder, -28_041).length;
            yield* admin.tap('✅ Надіслати в «Games»');

            expect(afterFirst).toBe(1);
            expect(fresh.text.split('\n')[0]).toBe(changed);
            expect(pollsTo(recorder, -28_041).map(call => call.payload.message_thread_id)).toEqual([undefined, 8]);
        })
    );
});
