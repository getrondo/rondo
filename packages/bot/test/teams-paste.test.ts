import { expect, layer } from '@effect/vitest';
import { syncMember } from '@rondo/core/identity/telegram-user';
import { addGuests } from '@rondo/core/signups/roster.service';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation } from './support/conversation';
import { teamsGame } from './support/teams-game';
import { buttonData, draftTeams, labelsOf, openEditor, playerData } from './support/teams-screen';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const postsTo = (chatId: number) => recorder.calls.filter(call => call.payload.chat_id === chatId && call.method === 'sendMessage');

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('pasted line-ups', it => {
    it.effect('keeps a name pasted twice in its first team, says so and posts without an error', () =>
        Effect.gen(function* () {
            const { sessionId } = yield* teamsGame('teams-paste-twice', { groupChatId: -3301, adminId: 331, players: 8 });
            const admin = conversation(recorder, adminNumbered(331));
            yield* openEditor(admin);
            yield* admin.type('🔴 Andriy, Bohdan, Vasyl, Hryhoriy\n🔵 Andriy, Dmytro, Yevhen, Zakhar, Ivan');
            const pasted = admin.screen();
            const { teams } = yield* draftTeams(sessionId);
            yield* admin.press(buttonData(pasted, '👌 Готово'));
            yield* admin.press(buttonData(admin.screen(), '✅ Надіслати в «Games»'));

            expect(pasted.text).toContain('«Andriy» двічі у списку — лишив у 🔴.');
            expect(teams.flat().filter(name => name === 'Andriy')).toHaveLength(1);
            expect(teams[0]).toContain('Andriy');
            expect(postsTo(-3301)).toHaveLength(1);
        })
    );

    it.effect('answers typed guests for a cancelled game with the reason instead of an error', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId } = yield* teamsGame('teams-paste-cancelled', { groupChatId: -3302, adminId: 332, players: 8 });
            const admin = conversation(recorder, adminNumbered(332));
            yield* openEditor(admin);
            yield* db.update(session).set({ status: 'cancelled' }).where(eq(session.id, sessionId));
            yield* admin.type('Andriy +1');

            expect(admin.screen().text).toContain('⚠️ Гра вже завершена або скасована, нічого не надіслано.');
            expect(admin.screen().text).toContain('✏️ <b>Склади');
        })
    );

    it.effect('takes each answer to a pasted question once, keeps the keeper mark on the member and not on his guest', () =>
        Effect.gen(function* () {
            const { sessionId } = yield* teamsGame('teams-paste-questions', { groupChatId: -3303, adminId: 333, players: 23 });
            const admin = conversation(recorder, adminNumbered(333));
            yield* openEditor(admin);
            yield* admin.type('🔴 Andriy, Bohdan, Vasyl 🧤 +1\n🔵 Hryhoriy, Dmytro, Yevhen');
            const first = admin.screen();
            const skip = buttonData(first, '⏭ Пропустити');
            yield* admin.press(skip);
            const second = admin.screen();
            yield* admin.press(skip);
            const repeated = admin.screen();
            yield* admin.press(buttonData(repeated, labelsOf(repeated)[0]?.[0] ?? ''));
            const { teams, row } = yield* draftTeams(sessionId);

            expect(first.text).toContain('«Andriy» — хто саме?');
            expect(second.text).toContain('«Bohdan» — хто саме?');
            expect(repeated.text).toContain('«Bohdan» — хто саме?');
            expect(teams[0]).toEqual(expect.arrayContaining(['Bohdan', 'Vasyl']));
            expect(
                row.state.teams[0]?.flatMap((personId, index) => (row.state.keepers.includes(personId) ? [teams[0]?.[index]] : []))
            ).toEqual(['Vasyl']);
        })
    );

    it.effect('leaves two players who are not in a team yet where they are when one is tapped after the other', () =>
        Effect.gen(function* () {
            const { sessionId } = yield* teamsGame('teams-paste-pending', { groupChatId: -3304, adminId: 334, players: 10 });
            const admin = conversation(recorder, adminNumbered(334));
            yield* openEditor(admin);
            yield* admin.type('🔴 Andriy, Bohdan, Vasyl, Hryhoriy\n🔵 Dmytro, Yevhen, Zakhar, Ivan');
            const before = yield* draftTeams(sessionId);
            yield* admin.press(playerData(admin.screen(), 'Kyrylo'));
            yield* admin.press(playerData(admin.screen(), 'Lev'));
            const after = yield* draftTeams(sessionId);

            expect(before.pending).toEqual(['Kyrylo', 'Lev']);
            expect(after.pending).toEqual(['Kyrylo', 'Lev']);
            expect(after.row.version).toBe(before.row.version);
        })
    );

    it.effect('gives a typed guest the host that was tapped even when the list of players changed in between', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId, people } = yield* teamsGame('teams-guest-host', { groupChatId: -3305, adminId: 335, players: 10 });
            const admin = conversation(recorder, adminNumbered(335));
            yield* openEditor(admin);
            yield* admin.tap('Lev');
            yield* admin.tap('➕ Гість від Lev');
            yield* db
                .update(signup)
                .set({ status: 'out' })
                .where(and(eq(signup.sessionId, sessionId), eq(signup.personId, people[0] ?? '')));
            yield* admin.type('Friend');
            const [guest] = yield* db
                .select({ hostId: signup.guestOfPersonId })
                .from(signup)
                .where(and(eq(signup.sessionId, sessionId), eq(signup.isGuest, true)));

            expect(guest?.hostId).toBe(people[9]);
        })
    );

    it.effect('adds one waiting guest when the place button of a full game is tapped twice', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId } = yield* teamsGame('teams-guest-full', { groupChatId: -3306, adminId: 336, players: 22 });
            const admin = conversation(recorder, adminNumbered(336));
            yield* openEditor(admin);
            yield* admin.tap('Lev');
            yield* admin.tap('➕ Гість від Lev');
            yield* admin.tap('+1');
            const place = admin.screen();
            const button = buttonData(place, '⏳ Додати в чергу');
            yield* admin.press(button);
            yield* admin.press(button);
            const guests = yield* db
                .select({ status: signup.status })
                .from(signup)
                .where(and(eq(signup.sessionId, sessionId), eq(signup.isGuest, true)));

            expect(guests.map(guest => guest.status)).toEqual(['waitlisted']);
        })
    );

    it.effect('never brings back a player who left, never drops one who came and never moves a locked one', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* teamsGame('teams-undo', { groupChatId: -3701, adminId: 371, players: 12 });
            const admin = conversation(recorder, adminNumbered(371));
            yield* openEditor(admin);
            const start = yield* draftTeams(sessionId);
            const [first = '', second = ''] = [start.teams[0]?.[0], start.teams[1]?.[0]];
            yield* admin.press(playerData(admin.screen(), first));
            yield* admin.press(playerData(admin.screen(), second));
            const leaver = start.teams[0]?.[1] ?? '';
            yield* db
                .update(signup)
                .set({ status: 'out' })
                .where(and(eq(signup.sessionId, sessionId), eq(signup.personId, start.row.state.teams[0]?.[1] ?? '')));
            const comer = yield* syncMember(communityId, { id: 937_101n, firstName: 'Comer' }, 'active');
            yield* db.insert(signup).values({ sessionId, personId: comer, status: 'in' });
            yield* openEditor(admin);
            yield* admin.press(buttonData(admin.screen(), '↩️ Скасувати останнє'));
            const undone = yield* draftTeams(sessionId);
            const locked = undone.teams[1]?.[0] ?? '';
            yield* admin.press(playerData(admin.screen(), locked));
            yield* admin.press(buttonData(admin.screen(), '🔒 Не чіпати'));
            yield* admin.press(buttonData(admin.screen(), '👌 Готово'));
            const variants = [];

            for (const _turn of [1, 2]) {
                const shown = admin.screen();
                expect(shown.buttons.flat().some(button => button.text.startsWith('🔀 Інший варіант'))).toBe(true);
                yield* admin.press(buttonData(shown, '🔀 Інший варіант'));
                variants.push(yield* draftTeams(sessionId));
            }

            for (const shown of [undone, ...variants]) {
                expect([...shown.teams.flat(), ...shown.pending]).not.toContain(leaver);
                expect([...shown.teams.flat(), ...shown.pending]).toContain('Comer');
            }

            for (const shown of variants) {
                expect(shown.teams[1]).toContain(locked);
                expect(shown.pending).toEqual([]);
            }
        })
    );

    it.effect('places a guest named twice, by his host and by his own name, only in the first team', () =>
        Effect.gen(function* () {
            const { sessionId, communityId, people } = yield* teamsGame('teams-paste-guest-twice', {
                groupChatId: -3307,
                adminId: 337,
                players: 8
            });
            yield* addGuests(
                { communityId, sessionId, actorPersonId: null },
                { hostPersonId: people[0] ?? '', count: 1, name: 'Friend Mark' }
            );
            const admin = conversation(recorder, adminNumbered(337));
            yield* openEditor(admin);
            yield* admin.type('🔴 Andriy +1, Bohdan, Vasyl, Hryhoriy\n🔵 Friend Mark, Dmytro, Yevhen, Zakhar, Ivan');
            const { teams } = yield* draftTeams(sessionId);

            expect(teams.flat().filter(name => name === 'Friend Mark')).toHaveLength(1);
            expect(teams[0]).toContain('Friend Mark');
        })
    );

    it.effect('places a guest described twice by his host only in the first team', () =>
        Effect.gen(function* () {
            const { sessionId } = yield* teamsGame('teams-paste-friend-twice', { groupChatId: -3308, adminId: 338, players: 8 });
            const admin = conversation(recorder, adminNumbered(338));
            yield* openEditor(admin);
            yield* admin.type('🔴 Andriy +1, Bohdan, Vasyl, Hryhoriy\n🔵 Friend Andriy, Dmytro, Yevhen, Zakhar, Ivan');
            const { row } = yield* draftTeams(sessionId);
            const placed = row.state.teams.flat();

            expect(placed).toHaveLength(new Set(placed).size);
        })
    );

    it.effect('adds an unknown name once when the answer is tapped again after the screen could not be shown', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId } = yield* teamsGame('teams-paste-retry', { groupChatId: -3309, adminId: 339, players: 10 });
            const admin = conversation(recorder, adminNumbered(339));
            yield* openEditor(admin);
            yield* admin.type('🔴 Andriy, Bohdan, Stranger\n🔵 Hryhoriy, Dmytro, Yevhen');
            const add = buttonData(admin.screen(), '➕ Додати як гостей');
            recorder.failures.set('editMessageText', new Error('socket hang up'));
            recorder.failures.set('sendMessage', new Error('socket hang up'));
            yield* admin.press(add).pipe(Effect.ignore);
            recorder.failures.delete('editMessageText');
            recorder.failures.delete('sendMessage');
            yield* admin.press(add);
            const guests = yield* db
                .select({ id: signup.personId })
                .from(signup)
                .where(and(eq(signup.sessionId, sessionId), eq(signup.isGuest, true)));

            expect(add).not.toBe('m:gone');
            expect(guests).toHaveLength(1);
        })
    );
});
