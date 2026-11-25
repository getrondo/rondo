import { expect, layer } from '@effect/vitest';
import { syncMember } from '@rondo/core/identity/telegram-user';
import { person } from '@rondo/db/schema/identity.schema';
import { rating } from '@rondo/db/schema/play.schema';
import { attendance, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation } from './support/conversation';
import { setNow } from './support/fixed-clock';
import { teamsGame } from './support/teams-game';
import { buttonData, draftTeams, openEditor, labelsOf, playerData } from './support/teams-screen';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();

const seats = Effect.fn('test.seats')(function* (sessionId: string) {
    const db = yield* Db;

    return yield* db.select({ status: signup.status, isGuest: signup.isGuest }).from(signup).where(eq(signup.sessionId, sessionId));
});

const statusOf = (sessionId: string, personId: string) =>
    Db.use(db =>
        db
            .select({ status: signup.status })
            .from(signup)
            .where(and(eq(signup.sessionId, sessionId), eq(signup.personId, personId)))
    ).pipe(Effect.map(rows => rows[0]?.status ?? null));

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('guests and the roster in the team editor', it => {
    it.effect('adds guests of a host in four taps, by «Name +2» and by a typed name, all counted in the limit', () =>
        Effect.gen(function* () {
            const { sessionId } = yield* teamsGame('teams-guests', { groupChatId: -3101, adminId: 311, players: 12 });
            const admin = conversation(recorder, adminNumbered(311));
            yield* openEditor(admin);
            const host = (yield* draftTeams(sessionId)).teams[0]?.[0] ?? '';
            yield* admin.press(buttonData(admin.screen(), '➕'));
            const hosts = admin.screen();
            yield* admin.press(buttonData(hosts, host));
            const counts = admin.screen();
            yield* admin.press(buttonData(counts, '+2'));
            const places = admin.screen();
            yield* admin.press(buttonData(places, `до ${host}`));
            const placed = yield* draftTeams(sessionId);
            yield* admin.type('Bohdan +1');
            const typed = yield* draftTeams(sessionId);
            yield* admin.press(buttonData(admin.screen(), '➕'));
            yield* admin.press(buttonData(admin.screen(), '👤 Ні чий'));
            yield* admin.type('Friend Mark');
            const named = yield* draftTeams(sessionId);
            const guests = (yield* seats(sessionId)).filter(seat => seat.isGuest);

            expect(hosts.text).toContain('➕ <b>Гість</b>. Чий він?');
            expect(labelsOf(counts)[0]).toEqual(['+1', '+2', '+3']);
            expect(places.text).toContain('Куди поставити?');
            expect(placed.teams[0]?.filter(name => name.startsWith(`${host} +`))).toHaveLength(2);
            expect(typed.teams.flat().filter(name => name.startsWith('Bohdan +'))).toHaveLength(1);
            expect(named.teams.flat()).toContain('Friend Mark');
            expect(named.row.state.joined).toEqual([]);
            expect(guests.map(seat => seat.status)).toEqual(['in', 'in', 'in', 'in']);
            expect(admin.tidy()).toEqual({ unanswered: [], oversized: [] });
        })
    );

    it.effect('asks about guests when a host leaves or moves, gives the seat to the first waiting and places a late joiner', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId, communityId } = yield* teamsGame('teams-remove', { groupChatId: -3102, adminId: 312, players: 12 });
            const admin = conversation(recorder, adminNumbered(312));
            const waiting = yield* syncMember(communityId, { id: 31_299n, firstName: 'Waiting' }, 'active');
            yield* openEditor(admin);
            const host = (yield* draftTeams(sessionId)).teams[1]?.[0] ?? '';
            yield* admin.type(`${host} +1`);
            yield* db.update(signup).set({ status: 'in' }).where(eq(signup.sessionId, sessionId));
            yield* db.insert(signup).values({ sessionId, personId: waiting, status: 'waitlisted' });
            yield* admin.press(playerData(admin.screen(), host));
            yield* admin.press(buttonData(admin.screen(), '🔴'));
            const moveAsk = admin.screen();
            yield* admin.press(buttonData(moveAsk, '👥 Разом'));
            const movedTogether = yield* draftTeams(sessionId);
            yield* admin.press(playerData(admin.screen(), host));
            yield* admin.press(buttonData(admin.screen(), '🗑'));
            const removeAsk = admin.screen();
            yield* admin.press(buttonData(removeAsk, '🗑 Разом з гостями'));
            const removed = yield* draftTeams(sessionId);
            yield* admin.press(buttonData(admin.screen(), '➕ Прийшов ще'));
            const joiners = admin.screen();
            yield* admin.press(buttonData(joiners, host));
            const joined = yield* draftTeams(sessionId);

            expect(moveAsk.text).toContain('з гостями (1). Перенести їх теж?');
            expect(movedTogether.teams[0]).toEqual(expect.arrayContaining([host, `${host} +1`]));
            expect(removeAsk.text).toContain('⏳ Місце займе Waiting.');
            expect(removed.teams.flat()).not.toContain(host);
            expect(removed.teams.flat()).toContain('Waiting');
            expect(joiners.text).toContain('Хто прийшов?');
            expect(joined.teams.flat()).toContain(host);
            expect(joined.pending).toEqual([]);
        })
    );

    it.effect('records a no-show on the field and rebalances, and sets tiers by tapping, never shown in the post', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId } = yield* teamsGame('teams-field', { groupChatId: -3103, adminId: 313, players: 13 });
            const admin = conversation(recorder, adminNumbered(313, 'ru'));
            yield* setNow(Date.parse('2026-11-27T17:45:00Z'));
            yield* openEditor(admin);
            const noLevels = admin.screen().text;
            const absent = (yield* draftTeams(sessionId)).teams[0]?.[0] ?? '';
            yield* admin.press(playerData(admin.screen(), absent));
            yield* admin.press(buttonData(admin.screen(), '➖ Не пришёл'));
            const after = yield* draftTeams(sessionId);
            yield* admin.press(buttonData(admin.screen(), '🎚 Уровни'));
            const tiers = admin.screen();
            const someone = after.teams[1]?.[0] ?? '';
            yield* admin.press(buttonData(tiers, someone));
            yield* admin.press(buttonData(admin.screen(), someone));
            const cycled = admin.screen();
            const stored = yield* db
                .select({ mu: rating.mu })
                .from(rating)
                .where(and(eq(rating.model, 'organizer_seed')));
            yield* admin.press(buttonData(cycled, '⬅️ К составам'));
            const withLevels = admin.screen().text;

            expect(noLevels).toContain('⚖️ уровни не заданы — делю по прошлым составам');
            expect(after.teams.flat()).not.toContain(absent);
            expect(after.teams.map(members => members.length)).toEqual([6, 6]);
            expect(tiers.text).toContain('видишь только ты');
            expect(labelsOf(cycled).flat()).toContain(`💪 ${someone}`);
            expect(stored.map(row => row.mu)).toContain(8);
            expect(withLevels).toMatch(/⚖️ [▰▱]{5}/u);
        })
    );

    it.effect(
        'takes an edited list pasted in the usual format, asks once about an unknown name and offers buttons for an ambiguous one',
        () =>
            Effect.gen(function* () {
                const { sessionId, communityId } = yield* teamsGame('teams-paste', { groupChatId: -3104, adminId: 314, players: 8 });
                yield* syncMember(communityId, { id: 31_490n, firstName: 'Lev' }, 'active');
                const chosen = yield* syncMember(communityId, { id: 31_491n, firstName: 'Lev' }, 'active');
                const admin = conversation(recorder, adminNumbered(314));
                yield* openEditor(admin);
                yield* admin.type('🔵 Andriy, Bohdan +1, Vasyl, Hryhoriy, Nobody\n🔴 Dmytro, Yevhen, Zakhar, Ivan, Lev');
                const ambiguous = admin.screen();
                yield* admin.press(ambiguous.buttons[1]?.[0]?.callback_data ?? '');
                const unknown = admin.screen();
                yield* admin.press(buttonData(unknown, '⏭ Пропустити'));
                const pasted = yield* draftTeams(sessionId);

                expect(ambiguous.text).toBe('❓ «Lev» — хто саме?');
                expect(labelsOf(ambiguous)).toEqual([['Lev'], ['Lev'], ['⏭ Пропустити']]);
                expect(unknown.text).toBe('❓ Не знаю: Nobody. Додати як гостей?');
                expect(pasted.teams[0]).toEqual(['Andriy', 'Bohdan', 'Bohdan +1', 'Vasyl', 'Hryhoriy']);
                expect(pasted.teams[1]).toEqual(['Dmytro', 'Yevhen', 'Zakhar', 'Ivan', 'Lev']);
                expect(pasted.row.state.teams[1]).toContain(chosen);
                expect(pasted.pending).toEqual([]);
                expect(pasted.row.state.colours).toEqual(['blue', 'red']);
                expect(admin.screen().text).toContain('📋 Взяв склади з тексту.');
            })
    );

    it.effect('asks before a late joiner goes over the limit of a full game and otherwise puts him in the queue', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* teamsGame('teams-seats-full', { groupChatId: -3601, adminId: 361, players: 22 });
            const waiting = yield* syncMember(communityId, { id: 936_101n, firstName: 'Queued' }, 'active');
            yield* db.insert(signup).values({ sessionId, personId: waiting, status: 'waitlisted' });
            const late = yield* syncMember(communityId, { id: 936_102n, firstName: 'Latecomer' }, 'active');
            const admin = conversation(recorder, adminNumbered(361));
            yield* setNow(Date.parse('2026-11-27T17:00:00Z'));
            yield* openEditor(admin);
            yield* admin.tap('➕ Прийшов ще');
            yield* admin.tap('Latecomer');
            const asked = admin.screen();
            yield* admin.press(buttonData(asked, '⏳ У чергу'));
            const queued = yield* statusOf(sessionId, late);
            yield* admin.tap('➕ Прийшов ще');
            yield* admin.tap('Latecomer');
            yield* admin.press(buttonData(admin.screen(), '➕ Понад ліміт'));
            const over = yield* statusOf(sessionId, late);
            const { teams } = yield* draftTeams(sessionId);

            expect(asked.text).toContain('Гра повна: 22 з 22.');
            expect(asked.text).toContain('⏳ У черзі: 1. Queued');
            expect(queued).toBe('waitlisted');
            expect(over).toBe('in');
            expect(teams.flat()).toContain('Latecomer');
        })
    );

    it.effect('offers remove next to no-show near the start and lets a no-show who came after all join again', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId } = yield* teamsGame('teams-seats-noshow', { groupChatId: -3602, adminId: 362, players: 12 });
            const admin = conversation(recorder, adminNumbered(362));
            yield* setNow(Date.parse('2026-11-27T17:45:00Z'));
            yield* openEditor(admin);
            const absent = (yield* draftTeams(sessionId)).teams[0]?.[0] ?? '';
            yield* admin.press(playerData(admin.screen(), absent));
            const selected = labelsOf(admin.screen()).flat();
            yield* admin.press(buttonData(admin.screen(), '➖ Не прийшов'));
            yield* admin.tap('➕ Прийшов ще');
            yield* admin.tap(absent);
            const marks = yield* db
                .select()
                .from(attendance)
                .where(and(eq(attendance.sessionId, sessionId), eq(attendance.outcome, 'no_show')));

            expect(selected).toEqual(expect.arrayContaining(['🗑 Прибрати', '➖ Не прийшов']));
            expect((yield* draftTeams(sessionId)).teams.flat()).toContain(absent);
            expect(marks).toEqual([]);
        })
    );

    it.effect('puts a pasted player of a full game in the queue and says so instead of seating him', () =>
        Effect.gen(function* () {
            const { communityId, sessionId } = yield* teamsGame('teams-seats-paste', { groupChatId: -3603, adminId: 363, players: 22 });
            const late = yield* syncMember(communityId, { id: 936_301n, firstName: 'Pasted' }, 'active');
            const admin = conversation(recorder, adminNumbered(363));
            yield* openEditor(admin);
            yield* admin.type('🔴 Bohdan, Vasyl, Hryhoriy, Pasted\n🔵 Dmytro, Yevhen, Zakhar, Ivan');

            expect(admin.screen().text).toContain('⏳ Гра повна — у черзі: Pasted. Понад ліміт: ➕ Прийшов ще.');
            expect(yield* statusOf(sessionId, late)).toBe('waitlisted');
            expect((yield* draftTeams(sessionId)).teams.flat()).not.toContain('Pasted');
        })
    );

    it.effect('tells the guests of a host with a long name apart on their buttons', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { people } = yield* teamsGame('teams-guest-labels', { groupChatId: -3112, adminId: 316, players: 10 });
            yield* db
                .update(person)
                .set({ displayName: 'Lev Polishchuk' })
                .where(eq(person.id, people[9] ?? ''));
            const admin = conversation(recorder, adminNumbered(316));
            yield* openEditor(admin);
            yield* admin.tap('➕');
            yield* admin.tap('Lev Polishchuk');
            yield* admin.tap('+2');
            yield* admin.press(
                admin
                    .screen()
                    .buttons.flat()
                    .find(button => button.text.includes('Lev'))?.callback_data ?? ''
            );
            const guests = labelsOf(admin.screen())
                .flat()
                .filter(label => label.startsWith('+'));

            expect(guests).toHaveLength(2);
            expect(new Set(guests).size).toBe(2);
        })
    );
});
