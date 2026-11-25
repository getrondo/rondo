import { expect, layer } from '@effect/vitest';
import { syncMember } from '@rondo/core/identity/telegram-user';
import { joinGame } from '@rondo/core/signups/roster.service';
import { makeRecorder, refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import * as Effect from 'effect/Effect';

import { conversation } from './support/conversation';
import { setNow } from './support/fixed-clock';
import { teamsGame } from './support/teams-game';
import { buttonData, draftTeams, labelsOf, openEditor, openOverview, playerData, titleData } from './support/teams-screen';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const sentTo = (chatId: number) => recorder.calls.filter(call => call.payload.chat_id === chatId);

const swapFirstTwo = (admin: ReturnType<typeof conversation>, sessionId: string) =>
    Effect.gen(function* () {
        const { teams } = yield* draftTeams(sessionId);
        yield* admin.press(buttonData(admin.screen(), '✏️ Змінити склади'));
        yield* admin.press(playerData(admin.screen(), teams[0]?.[1] ?? ''));
        yield* admin.press(playerData(admin.screen(), teams[1]?.[1] ?? ''));
        yield* admin.press(buttonData(admin.screen(), '👌 Готово'));
    });

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('team screens after the third design round', it => {
    it.effect('numbers the queue and the guests of each host on their own', () =>
        Effect.gen(function* () {
            yield* teamsGame('design-queue', { groupChatId: -3901, adminId: 391, players: 22 });
            const admin = conversation(recorder, adminNumbered(391));
            yield* openEditor(admin);
            yield* admin.press(playerData(admin.screen(), 'Lev'));
            yield* admin.press(buttonData(admin.screen(), '➕ Гість від Lev'));
            yield* admin.tap('+2');
            yield* admin.press(buttonData(admin.screen(), '⏳ Додати в чергу'));
            yield* admin.type('Bohdan +1');

            expect(admin.screen().text).toContain('⏳ У черзі: 1. Lev +1, 2. Lev +2, 3. Bohdan +1');
        })
    );

    it.effect('names who takes the seat only when removing really frees one', () =>
        Effect.gen(function* () {
            const { sessionId, communityId } = yield* teamsGame('design-seat', { groupChatId: -3902, adminId: 392, players: 22 });
            const admin = conversation(recorder, adminNumbered(392));
            yield* openEditor(admin);
            yield* admin.type('Lev +1');
            const extra = yield* syncMember(communityId, { id: 3_920_001n, firstName: 'Extra' }, 'active');
            yield* joinGame({ communityId, sessionId, actorPersonId: null }, [extra], true);
            yield* openEditor(admin);
            yield* admin.press(playerData(admin.screen(), 'Bohdan'));
            yield* admin.press(buttonData(admin.screen(), '🚫 Не грає'));

            expect(admin.screen().text).toContain('Bohdan не грає?');
            expect(admin.screen().text).not.toContain('Місце займе');
        })
    );

    it.effect('puts the players not in a team under one full-width row, then the button that places them', () =>
        Effect.gen(function* () {
            yield* teamsGame('design-pending', { groupChatId: -3903, adminId: 393, players: 8 });
            const admin = conversation(recorder, adminNumbered(393));
            yield* openEditor(admin);
            yield* admin.type('🔴 Andriy, Bohdan, Vasyl\n🔵 Hryhoriy, Dmytro, Yevhen');
            const labels = labelsOf(admin.screen());
            const header = labels.findIndex(row => row.length === 1 && row[0] === '🆕 Ще не в команді · 2');

            expect(header).toBeGreaterThan(0);
            expect(labels[header + 1]?.toSorted()).toEqual(['Ivan', 'Zakhar']);
            expect(labels[header + 2]).toEqual(['⚖️ Розставити нових']);
            expect(admin.screen().text).not.toContain('🆕 Ще не в команді:');
        })
    );

    it.effect('offers a new message or another try when Telegram refused the edit', () =>
        Effect.gen(function* () {
            const { sessionId } = yield* teamsGame('design-refused', { groupChatId: -3904, adminId: 394, players: 8 });
            const admin = conversation(recorder, adminNumbered(394));
            yield* openOverview(admin);
            yield* admin.press(buttonData(admin.screen(), '✅ Надіслати в «Games»'));
            yield* swapFirstTwo(admin, sessionId);
            recorder.failures.set('editMessageText', refusal('editMessageText', 'Bad Request: message can not be edited'));
            yield* admin.press(buttonData(admin.screen(), '✅ Оновити в «Games»'));
            recorder.failures.delete('editMessageText');
            const refused = admin.screen();
            yield* admin.press(buttonData(refused, '📨 Надіслати новим повідомленням'));

            expect(refused.text).toContain('⚠️ Telegram не дав змінити повідомлення в «Games» — там старі склади. Нового я не надсилав.');
            expect(labelsOf(refused).flat()).toEqual(expect.arrayContaining(['📨 Надіслати новим повідомленням', '🔁 Спробувати ще раз']));
            expect(sentTo(-3904).map(call => call.method)).toEqual(['sendMessage', 'editMessageText', 'sendMessage']);
        })
    );

    it.effect('says the group still has the old line-up and names each move with the team', () =>
        Effect.gen(function* () {
            const { sessionId } = yield* teamsGame('design-update', { groupChatId: -3905, adminId: 395, players: 8 });
            const admin = conversation(recorder, adminNumbered(395));
            yield* openOverview(admin);
            yield* admin.press(buttonData(admin.screen(), '✅ Надіслати в «Games»'));
            yield* swapFirstTwo(admin, sessionId);

            expect(admin.screen().text).toContain('📨 У «Games» поки старі склади.');
            expect(admin.screen().text).toMatch(/\n\S+ → 🔴 Червоні\n/u);
            expect(admin.screen().text).toMatch(/\n\S+ → 🔵 Сині/u);
            expect(admin.screen().text).not.toContain('📨 Склади вже');
        })
    );

    it.effect('says the admin still has the old line-up before an update to them', () =>
        Effect.gen(function* () {
            const { sessionId } = yield* teamsGame('design-update-me', {
                groupChatId: -3906,
                adminId: 396,
                players: 8,
                privateAudience: true
            });
            const admin = conversation(recorder, adminNumbered(396));
            yield* openOverview(admin);
            yield* admin.press(buttonData(admin.screen(), '✅ Надіслати мені'));
            yield* swapFirstTwo(admin, sessionId);

            expect(admin.screen().text).toContain('📨 У тебе поки старі склади.');
        })
    );

    it.effect('says in one line what changed while the admin was looking, without «nothing sent»', () =>
        Effect.gen(function* () {
            const { sessionId, communityId } = yield* teamsGame('design-looking', { groupChatId: -3907, adminId: 397, players: 8 });
            const admin = conversation(recorder, adminNumbered(397));
            yield* openOverview(admin);
            const newcomer = yield* syncMember(communityId, { id: 3_970_001n, firstName: 'Newcomer' }, 'active');
            yield* joinGame({ communityId, sessionId, actorPersonId: null }, [newcomer]);
            yield* admin.press(buttonData(admin.screen(), '✅ Надіслати в «Games»'));

            expect(admin.screen().text).toContain(
                '🔄 Поки ти дивився, список змінився: + Newcomer. Ось нові склади — перевір і натисни ✅.'
            );
            expect(admin.screen().text).not.toContain('Поки нічого не надіслано');
        })
    );

    it.effect('shows levels as names with a mark only when set and the balance in words', () =>
        Effect.gen(function* () {
            yield* teamsGame('design-levels', { groupChatId: -3908, adminId: 398, players: 8 });
            const admin = conversation(recorder, adminNumbered(398));
            yield* openEditor(admin);
            yield* admin.press(buttonData(admin.screen(), '⚙️ Рівні та кольори'));
            const unset = labelsOf(admin.screen()).flat();
            yield* admin.press(buttonData(admin.screen(), 'Bohdan'));
            const set = labelsOf(admin.screen()).flat();
            yield* admin.press(buttonData(admin.screen(), '⬅️ До складів'));

            expect(unset).toContain('Bohdan');
            expect(unset.some(label => label.startsWith('·'))).toBe(false);
            expect(set).toContain('🙂 Bohdan');
            expect(admin.screen().text).toMatch(/⚖️ (Сили рівні|Сили майже рівні|Одна команда сильніша)\./u);
            expect(admin.screen().text).not.toMatch(/[▰▱]|\d%/u);
        })
    );

    it.effect('lists late joiners by full name in one column', () =>
        Effect.gen(function* () {
            const { communityId } = yield* teamsGame('design-joiners', { groupChatId: -3909, adminId: 399, players: 8 });
            yield* syncMember(communityId, { id: 3_990_001n, firstName: 'Volodymyr', lastName: 'Kostenko-Zarichnyi' }, 'active');
            const admin = conversation(recorder, adminNumbered(399));
            yield* openEditor(admin);
            yield* admin.press(buttonData(admin.screen(), '➕ Хтось прийшов'));

            expect(labelsOf(admin.screen())).toContainEqual(['Volodymyr Kostenko-Zarichnyi']);
        })
    );

    it.effect('names the team sizes and where the goalkeepers are in words', () =>
        Effect.gen(function* () {
            const { sessionId } = yield* teamsGame('design-uneven', { groupChatId: -3910, adminId: 400, players: 8, keepers: 2 });
            const admin = conversation(recorder, adminNumbered(400));
            yield* openEditor(admin);
            const { row } = yield* draftTeams(sessionId);
            const keeperButtons = admin
                .screen()
                .buttons.flatMap(buttons => buttons.map((button, column) => ({ button, column })))
                .filter(entry => entry.button.text.includes('🧤'));
            const blueKeeper = keeperButtons.find(entry => entry.column === 1);
            yield* admin.press(blueKeeper?.button.callback_data ?? 'm:gone');
            yield* admin.press(titleData(admin.screen(), 0));

            expect(row.state.keepers).toHaveLength(2);
            expect(admin.screen().text).toContain('⚠️ Червоних 5, Синіх 3.');
            expect(admin.screen().text).toContain('⚠️ Обидва воротарі в Червоних.');
        })
    );

    it.effect('after the kick-off asks whether a player did not come or dropped out in advance', () =>
        Effect.gen(function* () {
            yield* teamsGame('design-after-start', { groupChatId: -3911, adminId: 401, players: 8 });
            yield* setNow(Date.parse('2026-11-27T18:15:00Z'));
            const admin = conversation(recorder, adminNumbered(401));
            yield* openEditor(admin);
            yield* admin.press(playerData(admin.screen(), 'Bohdan'));
            yield* admin.press(buttonData(admin.screen(), '🚫 Не грає'));

            expect(labelsOf(admin.screen())).toEqual([['🚫 Не прийшов на гру'], ['🗑 Відмовився заздалегідь'], ['⬅️ До складів']]);
        })
    );
});
