import { expect, layer } from '@effect/vitest';
import { syncMember } from '@rondo/core/identity/telegram-user';
import { attendance, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { conversation } from './support/conversation';
import { setNow } from './support/fixed-clock';
import { teamsGame } from './support/teams-game';
import { buttonData, draftTeams, labelsOf, openEditor, playerData } from './support/teams-screen';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();

const statusOf = (sessionId: string, personId: string) =>
    Db.use(db =>
        db
            .select({ status: signup.status })
            .from(signup)
            .where(and(eq(signup.sessionId, sessionId), eq(signup.personId, personId)))
    ).pipe(Effect.map(rows => rows[0]?.status ?? null));

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('seats when players join late', it => {
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
});
