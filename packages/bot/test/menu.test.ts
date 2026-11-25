import { expect, layer } from '@effect/vitest';
import { roleGrant } from '@rondo/db/schema/org.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder, refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { fromShortId } from '../src/utils/from-short-id.util';
import { toShortId } from '../src/utils/to-short-id.util';

import { conversation } from './support/conversation';
import { seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const member = { id: 777, is_bot: false as const, first_name: 'Member', language_code: 'ru' };

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('admin menu', it => {
    it.effect('round-trips ids in 22 characters', () =>
        Effect.sync(() => {
            const id = '019ab2c3-4d5e-7f60-8a9b-0c1d2e3f4a5b';

            expect(toShortId(id)).toHaveLength(22);
            expect(fromShortId(toShortId(id))).toBe(id);
            expect(fromShortId('not-an-id')).toBeNull();
        })
    );

    it.effect('greets an admin with the home screen and a member with one line', () =>
        Effect.gen(function* () {
            yield* seedSeason('menu-home', { groupChatId: -3001, adminId: 301 });
            const admin = conversation(recorder, adminNumbered(301));
            const stranger = conversation(recorder, member);
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Опублікувати');
            yield* admin.type('/start');
            const home = admin.screen();
            yield* stranger.type('/start');
            const commands = recorder.calls.findLast(call => call.method === 'setMyCommands')?.payload;

            expect(home.text).toContain('Наступна гра: <b>Пт 27.11 19:00 · North Arena</b>, записались 0 з 22');
            expect(home.buttons.flat()).toHaveLength(3);
            expect(stranger.screen().text).toContain('Пока я работаю с администраторами');
            expect(commands).toMatchObject({ scope: { type: 'chat', chat_id: 301 } });
        })
    );

    it.effect('edits one message through games, card, Back and Home, and ignores an unchanged message', () =>
        Effect.gen(function* () {
            yield* seedSeason('menu-nav', { groupChatId: -3002, adminId: 302 });
            const admin = conversation(recorder, adminNumbered(302));
            yield* admin.type('/menu');
            const home = admin.screen();
            yield* admin.tap('📅 Ігри');
            yield* admin.tap('Пт 20.11 19:00');
            const card = admin.screen();
            yield* admin.tap('⬅️ Назад');
            const games = admin.screen();
            yield* admin.tap('🏠 Меню');
            const sends = recorder.calls.filter(call => call.method === 'sendMessage').length;
            recorder.failures.set('editMessageText', refusal('editMessageText', 'Bad Request: message is not modified'));
            yield* admin.tap('📅 Ігри');
            const unchanged = recorder.calls.filter(call => call.method === 'sendMessage').length;
            recorder.failures.set('editMessageText', refusal('editMessageText', 'Bad Request: message to edit not found'));
            yield* admin.tap('📅 Ігри');
            recorder.failures.delete('editMessageText');
            const fallback = recorder.calls.filter(call => call.method === 'sendMessage').length;

            expect([card.id, games.id].every(id => id === home.id)).toBe(true);
            expect(admin.screen().id).not.toBe(home.id);
            expect(card.text).toContain('зіграно');
            expect(card.buttons.flat().map(button => button.text)).toEqual(['⬅️ Назад', '🏠 Меню']);
            expect(games.text).toContain('Минулі');
            expect(unchanged).toBe(sends);
            expect(fallback).toBe(unchanged + 1);
            expect(admin.tidy()).toEqual({ unanswered: [], oversized: [] });
        })
    );

    it.effect('explains a stale button and changes nothing for a revoked admin', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId } = yield* seedSeason('menu-revoked', { groupChatId: -3003, adminId: 303 });
            const admin = conversation(recorder, adminNumbered(303));
            yield* admin.type('/newgame');
            const old = admin.screen();
            yield* admin.type('/newgame');
            yield* admin.tapOn(old, '👥 +');
            const stale = recorder.calls.findLast(call => call.method === 'answerCallbackQuery')?.payload;
            yield* db
                .update(roleGrant)
                .set({ valid: sql`tstzrange('2020-01-01', '2020-01-02')` })
                .where(eq(roleGrant.communityId, communityId));
            yield* admin.press('m:gl');
            const revoked = recorder.calls.findLast(call => call.method === 'answerCallbackQuery')?.payload;

            expect(String(stale?.text)).toContain('застарів');
            expect(String(revoked?.text)).toContain('більше не адміністратор');
            expect(admin.screen().buttons).toEqual([]);
        })
    );
});
