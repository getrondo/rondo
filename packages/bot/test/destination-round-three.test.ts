import { expect, layer } from '@effect/vitest';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation } from './support/conversation';
import { gamesOn, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const pollsIn = (chatId: number) => recorder.calls.filter(call => call.method === 'sendPoll' && call.payload.chat_id === chatId);

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('destinations after the council', it => {
    it.effect('sends nothing when the previewed group moved to another topic and shows a fresh preview', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedSeason('r3-topic', { groupChatId: -21_101, adminId: 2111 });
            const admin = conversation(recorder, adminNumbered(2111));
            yield* admin.type('/newgame');
            yield* db.update(telegramChat).set({ topicId: 77 }).where(eq(telegramChat.chatId, -21_101n));
            yield* admin.tap('✅ Надіслати');
            const refused = admin.screen();
            yield* admin.tap('✅ Надіслати');
            const games = yield* gamesOn(communityId, '2026-11-27');

            expect(refused.text.split('\n').at(-1)).toBe('⚠️ Дані змінилися, нічого не надіслано. Переглянь ще раз і натисни ✅.');
            expect(pollsIn(-21_101)).toHaveLength(1);
            expect(pollsIn(-21_101)[0]?.payload.message_thread_id).toBe(77);
            expect(games).toHaveLength(1);
        })
    );
});
