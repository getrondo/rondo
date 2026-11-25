import { expect, layer } from '@effect/vitest';
import { syncMember } from '@rondo/core/identity/telegram-user';
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
            yield* admin.press(buttonData(pasted, '✅ Надіслати в «Games»'));
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

            expect(admin.screen().text).toContain('⚠️');
            expect(admin.screen().text).toContain('👕');
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
            yield* admin.tap('➕');
            yield* admin.tap('Lev');
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
            yield* admin.tap('➕');
            yield* admin.tap('Lev');
            yield* admin.tap('+1');
            const place = admin.screen();
            const button = place.buttons.flat().find(entry => entry.text.includes('до Lev'))?.callback_data ?? '';
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
            yield* admin.press(buttonData(admin.screen(), '⬅️ Назад'));
            yield* openEditor(admin);
            yield* admin.press(buttonData(admin.screen(), '↩️'));
            const undone = yield* draftTeams(sessionId);
            const locked = undone.teams[0]?.[0] ?? '';
            yield* admin.press(playerData(admin.screen(), locked));
            yield* admin.press(buttonData(admin.screen(), '🔒'));
            const variants = [];

            for (const label of ['2️⃣', '3️⃣']) {
                yield* admin.press(buttonData(admin.screen(), label));
                variants.push(yield* draftTeams(sessionId));
            }

            for (const shown of [undone, ...variants]) {
                expect([...shown.teams.flat(), ...shown.pending]).not.toContain(leaver);
                expect([...shown.teams.flat(), ...shown.pending]).toContain('Comer');
            }

            for (const shown of variants) {
                expect(shown.teams[0]).toContain(locked);
            }
        })
    );
});
