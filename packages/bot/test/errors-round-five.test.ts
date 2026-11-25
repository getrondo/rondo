import { expect, layer } from '@effect/vitest';
import { community } from '@rondo/db/schema/org.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation, labelsOf, pollsTo, walkManual } from './support/conversation';
import { seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('failures outside a confirmation', it => {
    it.effect('answers a card post with a broken template with the reason, a toast and navigation, never a failed update', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedSeason('r5-template', { groupChatId: -33_001, adminId: 3301 });
            const admin = conversation(recorder, adminNumbered(3301));
            yield* admin.type('/newgame');
            yield* walkManual(admin, ['🛠 З нуля', 'Сб 28.11', 'Park Field', '18:30', '👥 18', '💾 Зберегти без опитування']);
            yield* db
                .update(community)
                .set({ settings: sql`${community.settings} || ${JSON.stringify({ poll: { question: 7 } })}::jsonb` })
                .where(eq(community.id, communityId));
            const tapped = yield* admin.tap('📣 Надіслати в «Games»').pipe(Effect.exit);
            const screen = admin.screen();
            const toast = recorder.calls.findLast(call => call.method === 'answerCallbackQuery')?.payload.text;
            const reason = 'Шаблон опитування в налаштуваннях спільноти зламаний, нічого не надіслано.';

            expect(tapped._tag).toBe('Success');
            expect(screen.text).toBe(`⚠️ ${reason}`);
            expect(labelsOf(screen)).toEqual(['📅 Ігри', '🏠 Меню']);
            expect(toast).toBe(`⚠️ ${reason}`);
            expect(pollsTo(recorder, -33_001)).toEqual([]);
        })
    );
});
