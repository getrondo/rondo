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
import { buttonData, draftTeams, openEditor, labelsOf, playerData, titleData } from './support/teams-screen';
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
            yield* admin.press(buttonData(admin.screen(), '✖️'));
            const deselected = admin.screen();
            const locked = swapped.teams[0]?.[0] ?? '';
            yield* admin.press(playerData(admin.screen(), locked));
            yield* admin.press(buttonData(admin.screen(), '🔒'));
            yield* admin.press(buttonData(admin.screen(), '🔀'));
            const shuffled = yield* draftTeams(sessionId);
            yield* admin.press(buttonData(admin.screen(), '↩️'));
            const undone = yield* draftTeams(sessionId);
            const keeper = undone.teams[1]?.[3] ?? '';
            yield* admin.press(playerData(admin.screen(), keeper));
            yield* admin.press(buttonData(admin.screen(), '🧤'));
            const marked = admin.screen();

            expect(labelsOf(selected).find(row => row[0] === '🔒')).toEqual(['🔒', '🧤', '✖️']);
            expect(labelsOf(selected)).toContainEqual(['🗑 Прибрати з гри']);
            expect(selected.text).toContain(`▶ ${first}: торкнись іншого гравця`);
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

    it.effect('picks colours by a second tap on a title, keeps two teams apart in colour and shows four teams two at a time', () =>
        Effect.gen(function* () {
            yield* teamsGame('teams-colours', { groupChatId: -3002, adminId: 302, players: 26, keepers: 4 });
            const admin = conversation(recorder, adminNumbered(302, 'ru'));
            yield* openEditor(admin);
            const four = admin.screen();
            yield* admin.press(titleData(four, 1));
            yield* admin.press(titleData(admin.screen(), 1));
            const palette = admin.screen();
            yield* admin.press(buttonData(palette, '🔴'));
            const recoloured = admin.screen();
            yield* admin.press(buttonData(recoloured, '▶'));
            const second = admin.screen();

            expect(labelsOf(four)[0]).toEqual(['🔴 7', '🔵 7', '🟢 6', '🟡 6']);
            expect(labelsOf(four)[1]).toHaveLength(2);
            expect(labelsOf(four).some(row => row.join(',') === '◀,1/2,▶')).toBe(true);
            expect(palette.text).toContain('🎨 Выбери цвет для 🔵');
            expect(labelsOf(palette)[0]).toEqual(['🔴', '✓🔵', '🟢', '🟡', '⚪', '🟠']);
            expect(labelsOf(recoloured)[0]).toEqual(['🔵 7', '🔴 7', '🟢 6', '🟡 6']);
            expect(labelsOf(second).some(row => row.join(',') === '◀,2/2,▶')).toBe(true);
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
            yield* admin.press(buttonData(uneven, '↩️ '));
            const evened = yield* draftTeams(sessionId);

            expect(moved.teams.map(members => members.length)).toEqual([5, 7]);
            expect(uneven.text).toContain('⚠️ Команди відрізняються на двох');
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
                yield* openEditor(admin);
                const offered = admin.screen();
                yield* admin.tap('Не зараз');
                const dismissed = admin.screen();
                yield* openEditor(admin);
                const again = admin.screen();
                const second = conversation(recorder, adminNumbered(306, 'ru'));
                yield* openEditor(second);
                const third = conversation(recorder, adminNumbered(307));
                yield* openEditor(third);

                expect(offered.text).toContain('💡 Хочеш рівніші команди? Познач сильних, це один дотик.');
                expect(labelsOf(offered)).toContainEqual(['🎚 Позначити сильних']);
                expect(labelsOf(offered)).toContainEqual(['Не зараз']);
                expect(dismissed.text).not.toContain('💡 Хочеш');
                expect(again.text).not.toContain('💡 Хочеш');
                expect(second.screen().text).not.toContain('Хочешь');
                expect(third.screen().text).not.toContain('Хочеш');
            })
    );
});
