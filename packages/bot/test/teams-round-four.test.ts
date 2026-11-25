import { expect, layer } from '@effect/vitest';
import { swapPlayers } from '@rondo/core/teams/draft-state';
import { changeDraft } from '@rondo/core/teams/team-draft.service';
import { attendance, session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { teamsData } from '../src/menu/teams/teams-callback';

import { conversation } from './support/conversation';
import { setNow } from './support/fixed-clock';
import { teamsGame } from './support/teams-game';
import {
    buttonData,
    draftTeams,
    guestSignups,
    labelsOf,
    openEditor,
    pasteWithStranger,
    playerData,
    titleData
} from './support/teams-screen';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('team screens after the fourth council round', it => {
    it.effect('applies nothing from a paste answer when the teams changed meanwhile and asks for the list again', () =>
        Effect.gen(function* () {
            const { sessionId } = yield* teamsGame('round-four-paste', { groupChatId: -4101, adminId: 411, players: 10 });
            const admin = conversation(recorder, adminNumbered(411));
            const add = yield* pasteWithStranger(admin);
            const { row, teams } = yield* draftTeams(sessionId);
            const [first = '', second = ''] = row.state.teams.map(members => members[0] ?? '');
            yield* changeDraft({ sessionId, version: row.version, key: 'other', actorPersonId: null }, state =>
                Effect.succeed(swapPlayers(state, first, second))
            );
            yield* admin.press(add);

            expect(teams.flat()).toHaveLength(10);
            expect(yield* guestSignups(sessionId)).toEqual([]);
            expect(admin.screen().text).toContain('🔄 Поки ти відповідав, склади змінилися — встав список ще раз.');
        })
    );

    it.effect('marks and unmarks a no-show of a played game without touching the sign-up', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { sessionId, people } = yield* teamsGame('round-four-played', { groupChatId: -4102, adminId: 412, players: 8 });
            const admin = conversation(recorder, adminNumbered(412));
            yield* openEditor(admin);
            yield* db.update(session).set({ status: 'played' }).where(eq(session.id, sessionId));
            yield* setNow(Date.parse('2026-11-27T21:00:00Z'));
            const absent = people[1] ?? '';
            const mark = Effect.gen(function* () {
                const { row } = yield* draftTeams(sessionId);
                yield* admin.press(teamsData({ sessionId, version: row.version, page: 0 }, 'e'));
                yield* admin.press(playerData(admin.screen(), 'Bohdan'));
                yield* admin.press(buttonData(admin.screen(), '🚫 Не грає'));
                const asked = labelsOf(admin.screen());
                yield* admin.press(admin.screen().buttons[0]?.[0]?.callback_data ?? 'm:gone');

                return asked;
            });
            const marked = yield* mark;
            const missed = yield* db
                .select()
                .from(attendance)
                .where(and(eq(attendance.sessionId, sessionId), eq(attendance.personId, absent)));
            const unmarked = yield* mark;
            const back = yield* db
                .select()
                .from(attendance)
                .where(and(eq(attendance.sessionId, sessionId), eq(attendance.personId, absent)));
            const [seat] = yield* db
                .select()
                .from(signup)
                .where(and(eq(signup.sessionId, sessionId), eq(signup.personId, absent)));

            expect(marked).toEqual([['🚫 Не прийшов на гру'], ['⬅️ До складів']]);
            expect(missed.map(row => [row.outcome, row.source])).toEqual([['no_show', 'manual']]);
            expect(unmarked).toEqual([['↩️ Все ж прийшов'], ['⬅️ До складів']]);
            expect(back).toEqual([]);
            expect(seat?.status).toBe('in');
            expect((yield* draftTeams(sessionId)).teams.flat()).toContain('Bohdan');
        })
    );

    it.effect('offers the queued guests too when their host is removed', () =>
        Effect.gen(function* () {
            yield* teamsGame('round-four-host', { groupChatId: -4103, adminId: 413, players: 22 });
            const admin = conversation(recorder, adminNumbered(413));
            yield* openEditor(admin);
            yield* admin.type('Lev +2');
            yield* admin.press(playerData(admin.screen(), 'Lev'));
            yield* admin.press(buttonData(admin.screen(), '🚫 Не грає'));

            expect(labelsOf(admin.screen()).flat()).toContain('🗑 Разом з гостями (2)');
        })
    );

    it.effect('moves a selected player to a team on the other page', () =>
        Effect.gen(function* () {
            const { sessionId } = yield* teamsGame('round-four-pages', { groupChatId: -4104, adminId: 414, players: 26 });
            const admin = conversation(recorder, adminNumbered(414));
            yield* openEditor(admin);
            const { teams } = yield* draftTeams(sessionId);
            const mover = teams[0]?.[1] ?? '';
            yield* admin.press(playerData(admin.screen(), mover));
            yield* admin.press(buttonData(admin.screen(), 'Інші дві команди'));
            const other = admin.screen();
            yield* admin.press(titleData(other, 0));
            const after = yield* draftTeams(sessionId);

            expect(other.text).toContain(`Вибрано: <b>${mover}</b>`);
            expect(labelsOf(other)[0]?.every(label => label.startsWith('➡️'))).toBe(true);
            expect(after.teams[2]).toContain(mover);
        })
    );
});
