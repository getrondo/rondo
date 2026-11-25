import { expect, layer } from '@effect/vitest';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation, labelsOf } from './support/conversation';
import { gamesOn, seedSecondGroup, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const pollsIn = (chatId: number) => recorder.calls.filter(call => call.method === 'sendPoll' && call.payload.chat_id === chatId);
const sendingData = /^n:\d+:ok$|^c:ok:\d+:1$|^c:pr:|^c:fr:/u;
const sendingWord = /Надіслати|Отправить/u;

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('sending after the second design round', it => {
    it.effect('keeps a live preview on a second fast tap, still applies a step and sends only from the current revision', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('r2-fast', { groupChatId: -17_001, adminId: 1701 });
            const admin = conversation(recorder, adminNumbered(1701));
            yield* admin.type('/newgame');
            const first = admin.screen();
            yield* admin.tapOn(first, '+1');
            yield* admin.tapOn(first, '+1');
            const stepped = admin.screen();
            yield* admin.tapOn(first, '✅ Надіслати');
            const redrawn = admin.screen();
            const sentEarly = pollsIn(-17_001).length;
            yield* admin.tap('✅ Надіслати');
            const [game] = yield* gamesOn(communityId, '2026-11-27');

            expect(stepped.id).toBe(first.id);
            expect(labelsOf(stepped)).toContain('👥 24');
            expect(redrawn.id).toBe(first.id);
            expect(redrawn.text).toContain('Опитування буде таким:');
            expect(labelsOf(redrawn)).toContain('👥 24');
            expect(sentEarly).toBe(0);
            expect(pollsIn(-17_001)).toHaveLength(1);
            expect(game).toMatchObject({ capacityMax: 24 });
            expect(admin.tidy()).toEqual({ unanswered: [], oversized: [] });
        })
    );

    it.effect('shows a receipt only for the exact sent revision and leaves a newer screen on the same message alone', () =>
        Effect.gen(function* () {
            yield* seedSeason('r2-exact', { groupChatId: -17_002, adminId: 1702 });
            const admin = conversation(recorder, adminNumbered(1702));
            yield* admin.type('/newgame');
            const preview = admin.screen();
            yield* admin.tap('+1');
            yield* admin.tap('✅ Надіслати');
            const card = admin.screen();
            yield* admin.tapOn(preview, '✅ Надіслати');
            const afterOld = admin.screen();
            yield* admin.tap('🕖 Час');
            const times = admin.screen();
            yield* admin.tapOn(preview, '✅ Надіслати');
            const toast = recorder.calls.findLast(call => call.method === 'answerCallbackQuery');

            expect(afterOld).toEqual(card);
            expect(times.id).toBe(preview.id);
            expect(admin.screen()).toEqual(times);
            expect(toast?.payload.text).toBe('Екран застарів');
            expect(pollsIn(-17_002)).toHaveLength(1);
        })
    );

    it.effect('sends to the groups shown in the preview even when the linked groups change before ✅', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, north } = yield* seedSeason('r2-previewed', { groupChatId: -17_003, adminId: 1703 });
            const admin3 = conversation(recorder, adminNumbered(1703));
            yield* admin3.type('/newgame');
            const preview = admin3.screen();
            yield* seedSecondGroup(communityId, { main: -17_003, second: -17_004, venueId: north });
            yield* db
                .update(telegramChat)
                .set({ createdAt: new Date('2020-01-01T00:00:00Z') })
                .where(eq(telegramChat.chatId, -17_004n));
            yield* admin3.tap('✅ Надіслати');

            expect(preview.text).toContain('📤 Куди: «Games»');
            expect(pollsIn(-17_003)).toHaveLength(1);
            expect(recorder.calls.filter(call => call.payload.chat_id === -17_004)).toHaveLength(0);
            expect(admin3.screen().text.split('\n')[0]).toBe('✅ Гру створено, опитування в «Games».');
        })
    );

    it.effect('keeps the unknown-result warning through edits and names each group after a later forward times out', () =>
        Effect.gen(function* () {
            const { communityId, north } = yield* seedSeason('r2-unknown', { groupChatId: -17_005, adminId: 1705 });
            yield* seedSecondGroup(communityId, { main: -17_005, second: -17_006, venueId: north });
            const admin = conversation(recorder, adminNumbered(1705));
            yield* admin.type('/newgame');
            yield* admin.tap('📤 Куди');
            yield* admin.tap('«Games» і «Second»');
            recorder.failures.set('sendPoll', new Error('socket hang up'));
            yield* admin.tap('✅ Надіслати в обидві групи');
            recorder.failures.delete('sendPoll');
            const warned = admin.screen();
            yield* admin.tap('+1');
            yield* admin.type('20:00');
            const edited = admin.screen();
            recorder.failures.set('forwardMessage', new Error('socket hang up'));
            yield* admin.tap('✅ Немає, надіслати в «Games»');
            recorder.failures.delete('forwardMessage');
            const result = admin.screen().text.split('\n');
            const warning =
                '⚠️ Не знаю, чи дійшло опитування в «Games». Зазирни туди. Немає — натисни ✅ нижче. Є — спершу видали його там: я його не бачу й голоси не порахую.';

            expect(warned.text.split('\n').at(-1)).toBe(warning);
            expect(edited.text.split('\n').at(-1)).toBe(warning);
            expect(labelsOf(edited)[0]).toBe('✅ Немає, надіслати в «Games»');
            expect(edited.text).toContain('20.00');
            expect(result.slice(0, 2)).toEqual([
                '✅ Гру створено, опитування в «Games».',
                '⚠️ Не знаю, чи дійшло опитування в «Second». Зазирни туди. Немає — натисни ✅ нижче. Є — нічого не роби: голоси з нього рахуються.'
            ]);
        })
    );

    it.effect('starts every button that sends with ✅ and no other button', () =>
        Effect.gen(function* () {
            yield* seedSeason('r2-tick', { groupChatId: null, adminId: 1707 });
            const uk = conversation(recorder, adminNumbered(1707));
            yield* uk.type('/newgame');
            yield* uk.tap('🛠 З нуля');
            yield* uk.tap('Сб 28.11');
            yield* uk.tap('Park Field');
            yield* uk.tap('18:30');
            yield* uk.tap('👥 18');
            yield* uk.tap('💾 Зберегти без опитування');
            yield* uk.tap('👤 Надіслати опитування мені');
            yield* uk.tap('✅ Надіслати опитування мені');
            yield* uk.tap('✏️ Змінити');
            yield* uk.tap('🕖 Час');
            yield* uk.tap('19:00');
            const buttons = recorder.calls
                .filter(call => call.payload.chat_id === 1707)
                .flatMap(call => {
                    const markup = call.payload.reply_markup as
                        | { inline_keyboard?: { text: string; callback_data?: string }[][] }
                        | undefined;

                    return markup?.inline_keyboard?.flat() ?? [];
                });
            const sending = buttons.filter(button => sendingData.test(button.callback_data ?? ''));
            const ticked = buttons.filter(button => button.text.startsWith('✅'));

            expect(sending.length).toBeGreaterThan(3);
            expect(sending.filter(button => !button.text.startsWith('✅'))).toEqual([]);
            expect(ticked.filter(button => !sendingData.test(button.callback_data ?? ''))).toEqual([]);
            expect(
                new Set(buttons.filter(button => sendingWord.test(button.text) && !button.text.startsWith('✅')).map(button => button.text))
            ).toEqual(new Set(['👤 Надіслати опитування мені']));
        })
    );
});
