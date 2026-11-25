import { expect, layer } from '@effect/vitest';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Effect from 'effect/Effect';

import { conversation, labelsOf, unknownCardPoll } from './support/conversation';
import { seedSeason } from './support/season';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('live drafts after the second council round', it => {
    it.effect('keeps a live draft on a newer message when a card button on an older message sends', () =>
        Effect.gen(function* () {
            yield* seedSeason('r4-live-draft', { groupChatId: null, adminId: 3201 });
            const admin = conversation(recorder, adminNumbered(3201));
            yield* admin.type('/newgame');
            yield* admin.tap('✅ Надіслати опитування мені');
            yield* admin.tap('✏️ Змінити');
            const card = admin.screen();
            yield* admin.type('/newgame');
            const draft = admin.screen();
            yield* admin.tapOn(card, '✅ Надіслати опитування ще раз');
            yield* admin.tapOn(draft, '+1');
            const after = admin.seen().find(message => message.id === draft.id);

            expect(labelsOf(after ?? draft)).toContain('👥 19');
        })
    );

    it.effect('asks before a new game from an older menu replaces a draft on a newer message', () =>
        Effect.gen(function* () {
            yield* seedSeason('r4-live-ask', { groupChatId: -32_002, adminId: 3202 });
            const admin = conversation(recorder, adminNumbered(3202, 'ru'));
            yield* admin.type('/menu');
            const home = admin.screen();
            yield* admin.type('/menu');
            const other = admin.screen();
            yield* admin.type('/newgame');
            yield* admin.tap('+1');
            yield* admin.tapOn(home, '➕ Новая игра');
            const asked = admin.screen();
            yield* admin.tap('▶️ Продолжить');
            const continued = admin.screen();
            yield* admin.tapOn(other, '➕ Новая игра');
            yield* admin.tap('🔄 Начать заново');
            const restarted = admin.screen();

            expect(asked.id).toBe(home.id);
            expect(asked.text).toBe('Есть незаконченная новая игра. Продолжить её или начать заново?');
            expect(labelsOf(asked)).toEqual(['▶️ Продолжить', '🔄 Начать заново']);
            expect(continued.id).toBe(home.id);
            expect(labelsOf(continued)).toContain('👥 23');
            expect(labelsOf(restarted)).toContain('👥 22');
        })
    );

    it.effect('says how long the poll is when a poll line makes it too long, in Ukrainian and Russian', () =>
        Effect.gen(function* () {
            yield* seedSeason('r4-too-long', { groupChatId: -32_003, adminId: 3203 });
            const uk = conversation(recorder, adminNumbered(3203));
            yield* uk.type('/newgame');
            yield* uk.tap('📝 Рядок');
            yield* uk.type('x'.repeat(280));
            const long = uk.screen();
            yield* seedSeason('r4-too-long-ru', { groupChatId: -32_004, adminId: 3204 });
            const ru = conversation(recorder, adminNumbered(3204, 'ru'));
            yield* ru.type('/newgame');
            yield* ru.tap('📝 Строка');
            yield* ru.type('x'.repeat(280));

            expect(long.text.split('\n').at(-1)).toMatch(/^⚠️ Опитування задовге: \d{3} символів із 300\. Скороти рядок\.$/u);
            expect(labelsOf(long).some(label => label.startsWith('✅'))).toBe(false);
            expect(ru.screen().text.split('\n').at(-1)).toMatch(/^⚠️ Опрос слишком длинный: \d{3} символов из 300\. Сократи строку\.$/u);
        })
    );

    it.effect('asks before a card retry replaces a draft on a newer message', () =>
        Effect.gen(function* () {
            yield* seedSeason('r5-retry-draft', { groupChatId: -32_005, adminId: 3205 });
            const admin = conversation(recorder, adminNumbered(3205));
            yield* admin.type('/newgame');
            yield* unknownCardPoll(recorder, admin);
            const card = admin.screen();
            yield* admin.type('/newgame');
            const draft = admin.screen();
            yield* admin.tapOn(card, '📣 Немає, надіслати в «Games»');
            const asked = admin.seen().find(message => message.id === card.id);
            yield* admin.tapOn(draft, '+1');
            const kept = admin.seen().find(message => message.id === draft.id);
            yield* admin.tapOn(asked ?? card, '📣 Немає, надіслати в «Games»');
            const confirmation = admin.screen();

            expect(asked?.text).toBe('Є незавершена нова гра. Продовжити її чи почати заново?');
            expect(labelsOf(asked ?? card)).toEqual(['▶️ Продовжити', '📣 Немає, надіслати в «Games»']);
            expect(labelsOf(kept ?? draft)).toContain('👥 23');
            expect(confirmation.text.split('\n')[0]).toBe('Так буде в «Games»:');
        })
    );
});
