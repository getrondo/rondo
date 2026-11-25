import { expect, layer } from '@effect/vitest';
import { syncMember } from '@rondo/core/identity/telegram-user';
import { rating } from '@rondo/db/schema/play.schema';
import { signup } from '@rondo/db/schema/scheduling.schema';
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
});
