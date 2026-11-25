import { expect, layer } from '@effect/vitest';
import { setTier } from '@rondo/core/teams/team.service';
import { team } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';

import { conversation } from './support/conversation';
import { grantOrganizer } from './support/season';
import { teamsGame } from './support/teams-game';
import { buttonData, draftTeams, openEditor, openOverview, labelsOf, playerData, titleData } from './support/teams-screen';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('team editor', it => {
    it.effect('swaps with two taps, moves to a title, deselects, locks and shuffles the rest, undoes and marks a keeper', () =>
        Effect.gen(function* () {
            const { sessionId } = yield* teamsGame('teams-taps', { groupChatId: -3001, adminId: 301, players: 14, keepers: 2 });
            const admin = conversation(recorder, adminNumbered(301));
            yield* openEditor(admin);
            const start = yield* draftTeams(sessionId);
            const [first = '', second = ''] = [start.teams[0]?.[2], start.teams[1]?.[2]];
            yield* admin.press(playerData(admin.screen(), first));
            const selected = admin.screen();
            yield* admin.press(playerData(admin.screen(), second));
            const swapped = yield* draftTeams(sessionId);
            yield* admin.press(playerData(admin.screen(), first));
            yield* admin.press(titleData(admin.screen(), 0));
            const moved = yield* draftTeams(sessionId);
            yield* admin.press(playerData(admin.screen(), second));
            yield* admin.press(buttonData(admin.screen(), '✖️ Скасувати вибір'));
            const deselected = admin.screen();
            const locked = swapped.teams[0]?.[0] ?? '';
            yield* admin.press(playerData(admin.screen(), locked));
            yield* admin.press(buttonData(admin.screen(), '🔒 Не чіпати'));
            const lockedScreen = admin.screen();
            yield* admin.press(buttonData(admin.screen(), '🔀 Перемішати інших'));
            const shuffled = yield* draftTeams(sessionId);
            yield* admin.press(buttonData(admin.screen(), '↩️ Скасувати останнє'));
            const undone = yield* draftTeams(sessionId);
            const keeper = undone.teams[1]?.[3] ?? '';
            yield* admin.press(playerData(admin.screen(), keeper));
            yield* admin.press(buttonData(admin.screen(), '🧤 Воротар'));
            const marked = admin.screen();

            expect(labelsOf(selected).slice(-4)).toEqual([
                ['🧤 Воротар', '🔒 Не чіпати'],
                ['🚫 Не грає'],
                [`➕ Гість від ${first}`],
                ['✖️ Скасувати вибір']
            ]);
            expect(labelsOf(selected)[0]).toEqual(['🔴 Червоні · 7', '➡️ до Синіх']);
            expect(selected.text).toContain(`Вибрано: <b>${first}</b> (Червоні)`);
            expect(
                labelsOf(lockedScreen)
                    .flat()
                    .some(label => label.startsWith('🔒') && label.endsWith(locked))
            ).toBe(true);
            expect(labelsOf(lockedScreen).flat()).toContain('🔀 Перемішати інших');
            expect(swapped.teams[0]).toContain(second);
            expect(swapped.teams[1]).toContain(first);
            expect(moved.teams.map(members => members.length)).toEqual([8, 6]);
            expect(deselected.text).toContain('👆 Торкнись гравця');
            expect(shuffled.teams[0]).toContain(locked);
            expect(shuffled.teams.map(members => members.length)).toEqual([7, 7]);
            expect(undone.teams).toEqual(moved.teams);
            expect(marked.buttons.flat().some(button => button.text === `🧤 ${keeper}`)).toBe(true);
            expect(admin.tidy()).toEqual({ unanswered: [], oversized: [] });
        })
    );

    it.effect('picks colours in the settings, keeps two teams apart in colour and shows four teams two at a time', () =>
        Effect.gen(function* () {
            const { sessionId } = yield* teamsGame('teams-colours', { groupChatId: -3002, adminId: 302, players: 26, keepers: 4 });
            const admin = conversation(recorder, adminNumbered(302, 'ru'));
            yield* openEditor(admin);
            const four = admin.screen();
            yield* admin.press(buttonData(four, '⚙️ Уровни и цвета'));
            const settings = admin.screen();
            yield* admin.press(buttonData(settings, '🎨 🔵 Синие'));
            const palette = admin.screen();
            yield* admin.press(buttonData(palette, '🔴 Красные'));
            const { row } = yield* draftTeams(sessionId);
            yield* admin.press(buttonData(admin.screen(), '⬅️ К составам'));
            yield* admin.press(buttonData(admin.screen(), 'Другие две команды ▶'));
            const second = admin.screen();

            expect(labelsOf(four)[0]).toEqual(['🔴 Красные · 7', '🔵 Синие · 7']);
            expect(labelsOf(four)[1]).toHaveLength(2);
            expect(labelsOf(four).flat()).toContain('🟢🟡 Другие две команды ▶');
            expect(palette.text).toContain('🎨 Цвет для 🔵 Синие:');
            expect(labelsOf(palette)[0]).toEqual(['🔴 Красные', '✓🔵 Синие']);
            expect(row.state.colours.slice(0, 2)).toEqual(['blue', 'red']);
            expect(labelsOf(second)[0]).toEqual(['🟢 Зелёные · 6', '🟡 Жёлтые · 6']);
            expect(labelsOf(second).flat()).toContain('🔵🔴 Другие две команды ▶');
            expect(admin.tidy()).toEqual({ unanswered: [], oversized: [] });
        })
    );

    it.effect('offers one tap to even out sizes two apart, ignores a double tap and tells a second admin the teams changed', () =>
        Effect.gen(function* () {
            const { sessionId, communityId } = yield* teamsGame('teams-two-admins', { groupChatId: -3003, adminId: 303, players: 12 });
            yield* grantOrganizer(communityId, 304);
            const admin = conversation(recorder, adminNumbered(303));
            const other = conversation(recorder, adminNumbered(304, 'ru'));
            yield* openEditor(admin);
            yield* openEditor(other);
            const start = yield* draftTeams(sessionId);
            const mover = start.teams[0]?.[1] ?? '';
            yield* admin.press(playerData(admin.screen(), mover));
            const moveTap = titleData(admin.screen(), 1);
            yield* admin.press(moveTap);
            const moved = yield* draftTeams(sessionId);
            const uneven = admin.screen();
            yield* admin.press(moveTap);
            const twice = yield* draftTeams(sessionId);
            yield* other.press(playerData(other.screen(), start.teams[1]?.[0] ?? ''));
            const told = other.screen();
            const toasts = recorder.calls
                .filter(call => call.method === 'answerCallbackQuery')
                .map(call => (Predicate.isString(call.payload.text) ? call.payload.text : ''));
            yield* admin.press(buttonData(uneven, '⚖️ Вирівняти:'));
            const evened = yield* draftTeams(sessionId);

            expect(moved.teams.map(members => members.length)).toEqual([5, 7]);
            expect(uneven.text).toMatch(/⚠️ \S+ \d+, \S+ \d+\./u);
            expect(twice.row.version).toBe(moved.row.version);
            expect(told.text).toContain('🔄 Составы изменил другой админ');
            expect(toasts.at(-1)).toBe('🔄 Составы изменил другой админ — вот новые.');
            expect(evened.teams.map(members => members.length)).toEqual([6, 6]);
            expect(admin.tidy()).toEqual({ unanswered: [], oversized: [] });
        })
    );

    it.effect(
        'offers once, quietly, to mark the strong after three games without levels and keeps quiet for 30 days after «Не зараз»',
        () =>
            Effect.gen(function* () {
                const db = yield* Db;
                const withTeams = Effect.fn('test.withTeams')(function* (communityId: string, games: number) {
                    const played = yield* db
                        .select({ id: session.id })
                        .from(session)
                        .where(and(eq(session.communityId, communityId), eq(session.status, 'played')))
                        .limit(games);

                    for (const game of played) {
                        yield* db.insert(team).values({ sessionId: game.id, ordinal: 1 });
                    }
                });
                const due = yield* teamsGame('teams-nudge', { groupChatId: -3004, adminId: 305, players: 10 });
                const early = yield* teamsGame('teams-nudge-two', { groupChatId: -3005, adminId: 306, players: 10 });
                const levelled = yield* teamsGame('teams-nudge-levels', { groupChatId: -3006, adminId: 307, players: 10 });
                yield* withTeams(due.communityId, 3);
                yield* withTeams(early.communityId, 2);
                yield* withTeams(levelled.communityId, 3);
                yield* setTier({
                    communityId: levelled.communityId,
                    personId: levelled.people[0] ?? '',
                    tier: 'strong',
                    actorPersonId: null
                });
                const admin = conversation(recorder, adminNumbered(305));
                yield* openOverview(admin);
                const offered = admin.screen();
                yield* admin.tap('Не зараз');
                const dismissed = admin.screen();
                yield* openOverview(admin);
                const again = admin.screen();
                const second = conversation(recorder, adminNumbered(306, 'ru'));
                yield* openOverview(second);
                const third = conversation(recorder, adminNumbered(307));
                yield* openOverview(third);

                expect(offered.text).toContain('💡 Хочеш рівніші команди? Познач сильних, це один дотик.');
                expect(labelsOf(offered)).toContainEqual(['⚙️ Позначити сильних']);
                expect(labelsOf(offered)).toContainEqual(['Не зараз']);
                expect(dismissed.text).not.toContain('💡 Хочеш');
                expect(again.text).not.toContain('💡 Хочеш');
                expect(second.screen().text).not.toContain('Хочешь');
                expect(third.screen().text).not.toContain('Хочеш');
            })
    );

    it.effect('says plainly when the keepers are no longer spread over the teams', () =>
        Effect.gen(function* () {
            const { sessionId } = yield* teamsGame('teams-keepers', { groupChatId: -3007, adminId: 308, players: 12, keepers: 2 });
            const admin = conversation(recorder, adminNumbered(308));
            yield* openEditor(admin);
            const { row, teams } = yield* draftTeams(sessionId);
            const keeperTeams = row.state.keepers.map(personId => row.state.teams.findIndex(members => members.includes(personId)));
            const moving =
                teams[keeperTeams[1] ?? 0]?.[row.state.teams[keeperTeams[1] ?? 0]?.indexOf(row.state.keepers[1] ?? '') ?? 0] ?? '';
            yield* admin.press(playerData(admin.screen(), moving));
            yield* admin.press(titleData(admin.screen(), keeperTeams[0] ?? 0));

            expect(keeperTeams.toSorted((left, right) => left - right)).toEqual([0, 1]);
            expect(admin.screen().text).toMatch(/⚠️ Обидва воротарі в \S+\./u);
        })
    );
});
