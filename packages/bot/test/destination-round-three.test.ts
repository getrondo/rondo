import { expect, layer } from '@effect/vitest';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { toShortId } from '../src/utils/to-short-id.util';

import { conversation, pollsTo } from './support/conversation';
import { gamesOn, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();

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
            expect(pollsTo(recorder, -21_101)).toHaveLength(1);
            expect(pollsTo(recorder, -21_101)[0]?.payload.message_thread_id).toBe(77);
            expect(games).toHaveLength(1);
        })
    );

    it.effect('says a place of another community is gone and offers no ✅ on the preview or the card', () =>
        Effect.gen(function* () {
            yield* seedSeason('r3-own-place', { groupChatId: -21_102, adminId: 2112 });
            const { park: foreign } = yield* seedSeason('r3-foreign-place', { groupChatId: -21_103, adminId: 2113 });
            const admin = conversation(recorder, adminNumbered(2112));
            yield* admin.type('/newgame');
            const [revision] = /^n:(\d+):/u.exec(admin.screen().buttons[0]?.[0]?.callback_data ?? '')?.slice(1) ?? [];
            yield* admin.press(`n:${revision}:vs:${toShortId(foreign)}`);
            const preview = admin.screen();
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати');
            yield* admin.press(
                `c:vs:${
                    /^m:g:(.+)$/u.exec(
                        admin
                            .screen()
                            .buttons.flat()
                            .find(button => button.callback_data?.startsWith('c:t:'))
                            ?.callback_data?.replace(/^c:t:/u, 'm:g:') ?? ''
                    )?.[1] ?? ''
                }:${toShortId(foreign)}`
            );
            const card = admin.screen();

            expect(preview.text.split('\n').at(-1)).toBe('⚠️ Цього місця вже немає.');
            expect(preview.buttons.flat().some(button => button.text.startsWith('✅'))).toBe(false);
            expect(card.text).not.toContain('Park Field');
            expect(card.buttons.flat().some(button => button.text.startsWith('✅'))).toBe(false);
        })
    );
});
