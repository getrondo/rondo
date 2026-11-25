import { expect, layer } from '@effect/vitest';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Effect from 'effect/Effect';

import { conversation, deliver, labelsOf, lastPollId, walkManual } from './support/conversation';
import { gamesOn, seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const lastPoll = (chatId: number) => lastPollId(recorder, chatId);
const voteIn = (pollId: string, ids: readonly number[], optionIds: number[]) =>
    Effect.all(
        ids.map(id =>
            deliver({
                poll_answer: {
                    poll_id: pollId,
                    user: { id, is_bot: false, first_name: `Player ${id}` },
                    option_ids: optionIds,
                    option_persistent_ids: []
                }
            })
        ),
        { concurrency: 1 }
    );
const sentTo = (chatId: number, method: string) => recorder.calls.filter(call => call.method === method && call.payload.chat_id === chatId);

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('game card after the first design round', it => {
    it.effect('shows players page by page and where the poll is, and moves a game to another day', () =>
        Effect.gen(function* () {
            const { communityId } = yield* seedSeason('r1-card', { groupChatId: -16_001, adminId: 1601 });
            const admin = conversation(recorder, adminNumbered(1601));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати');
            yield* voteIn(lastPoll(-16_001), [9601, 9602, 9603, 9604, 9605, 9606, 9607, 9608, 9609, 9610], [0]);
            yield* admin.type('/games');
            yield* admin.tap('Пт 27.11 19:00');
            const first = admin.screen();
            yield* admin.tap('▶️');
            const second = admin.screen();
            yield* admin.tap('📅 День');
            yield* admin.tap('Сб 28.11');
            const confirmation = admin.screen().text;
            yield* admin.tap('✅ Змінити й написати в «Games»');
            const [moved] = yield* gamesOn(communityId, '2026-11-28');

            expect(first.text).toContain('📣 Опитування: «Games»');
            expect(first.text).toContain('8. Player 9608');
            expect(first.text).not.toContain('9. Player 9609');
            expect(second.text).toContain('10. Player 9610');
            expect(confirmation.startsWith('Так буде в «Games»:')).toBe(true);
            expect(confirmation).toContain(
                'Опитування в чаті не зміниться, там залишиться стара дата. Гравці дізнаються з цього повідомлення.'
            );
            expect(moved).toBeDefined();
        })
    );

    it.effect('keeps a game posted to me in my chat: poll, resend, teams and notices with a forward hint', () =>
        Effect.gen(function* () {
            yield* seedSeason('r1-mine', { groupChatId: null, adminId: 1602 });
            const admin = conversation(recorder, adminNumbered(1602));
            yield* admin.type('/newgame');
            yield* walkManual(admin, ['🛠 З нуля', 'Сб 28.11', 'Park Field', '18:30', '👥 18', '💾 Зберегти без опитування']);
            const saved = admin.screen();
            yield* admin.tap('👤 Надіслати опитування мені');
            const ask = admin.screen().text;
            yield* admin.tap('✅ Надіслати опитування мені');
            const receipt = admin.screen();
            yield* admin.tap('✏️ Змінити');
            const mine = admin.screen();
            yield* admin.tap('✅ Надіслати опитування ще раз');
            const resent = sentTo(1602, 'forwardMessage');
            yield* voteIn(lastPoll(1602), [9701, 9702, 9703, 9704], [0]);
            yield* admin.type('/games');
            yield* admin.tap('Сб 28.11 18:30');
            yield* admin.tap('👕 Склади');
            yield* admin.tap('2 команди');
            const teamsAsk = admin.screen();
            yield* admin.tap('✅ Надіслати мені');
            const lineup = sentTo(1602, 'sendMessage').findLast(call => String(call.payload.text).startsWith('<b>Склади'));
            yield* admin.tap('🕖 Час');
            yield* admin.tap('19:00');
            const changeAsk = admin.screen();
            yield* admin.tap('✅ Змінити й надіслати мені');
            const notice = sentTo(1602, 'sendMessage').findLast(call => String(call.payload.text).includes('📢'));

            expect(saved.text).toContain('📭 Опитування ще немає');
            expect(ask.startsWith('Надішлю тобі, а ти перешлеш у групу:')).toBe(true);
            expect(receipt.text).toBe('✅ Опитування в тебе.\nНатисни й утримуй опитування → Переслати → група.');
            expect(mine.text).toContain('👤 Опитування в тебе, переслати треба самому');
            expect(resent).toHaveLength(1);
            expect(teamsAsk.text.startsWith('Надішлю тобі, а ти перешлеш у групу:')).toBe(true);
            expect(String(lineup?.payload.text)).toContain('↪️ Перешли це в групу.');
            expect(labelsOf(changeAsk)).toEqual(expect.arrayContaining(['✅ Змінити й надіслати мені', 'Змінити без повідомлення']));
            expect(String(notice?.payload.text)).toContain('↪️ Перешли це в групу.');
        })
    );

    it.effect('sends automatic messages of a game posted to me only to me, even with a linked group', () =>
        Effect.gen(function* () {
            yield* seedSeason('r1-private', { groupChatId: -16_003, adminId: 1603 });
            const admin = conversation(recorder, adminNumbered(1603));
            yield* admin.type('/newgame');
            yield* admin.tap('👥 22');
            yield* admin.type('1');
            yield* admin.tap('📤 Куди');
            yield* admin.tap('👤 Тільки мені');
            yield* admin.tap('✅ Надіслати опитування мені');
            const pollId = lastPoll(1603);
            yield* voteIn(pollId, [9801, 9802], [0]);
            yield* voteIn(pollId, [9801], []);
            const promoted = sentTo(1603, 'sendMessage').findLast(call => String(call.payload.text).includes('Player 9802'));

            expect(promoted).toBeDefined();
            expect(recorder.calls.filter(call => call.payload.chat_id === -16_003)).toHaveLength(0);
        })
    );

    it.effect('asks before a permanent delete, says the poll closes on cancel and shows the limit change', () =>
        Effect.gen(function* () {
            yield* seedSeason('r1-ask', { groupChatId: -16_004, adminId: 1604 });
            const admin = conversation(recorder, adminNumbered(1604));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати');
            yield* admin.tap('🗑 Видалити');
            const remove = admin.screen();
            yield* admin.tap('⬅️ Назад');
            yield* admin.tap('✖️ Скасувати гру');
            yield* admin.tap('Погода');
            const cancel = admin.screen().text;
            yield* admin.tap('⬅️ Назад');
            yield* admin.tap('👥 Ліміт');
            yield* admin.type('20');
            const limit = admin.screen().text;

            expect(remove.text).toBe(
                '🗑 Видалити гру: Пт 27.11 19:00 · North Arena?\nОпитування закриється. Бот нікому не напише. Повернути гру не можна.\nПереслані копії можуть лишитися видимими.'
            );
            expect(labelsOf(remove)).not.toContain('🏠 Меню');
            expect(labelsOf(remove)).toContain('🗑 Видалити назавжди');
            expect(cancel).toContain('Опитування закриється в будь-якому разі.');
            expect(limit).toMatch(/<blockquote>[\s\S]*👥 Місць: 22 → 20[\s\S]*<\/blockquote>/u);
            expect(limit).toContain(
                'Опитування в чаті не зміниться, там залишиться старе число місць. Гравці дізнаються з цього повідомлення.'
            );
        })
    );
});
