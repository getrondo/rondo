import { expect, layer } from '@effect/vitest';
import { isDefined } from '@rnw-community/shared';
import { syncMember } from '@rondo/core/identity/telegram-user';
import { loadDraft, markRosterChanged } from '@rondo/core/teams/team-draft.service';
import { person, personAlias } from '@rondo/db/schema/identity.schema';
import { teamDraft } from '@rondo/db/schema/play.schema';
import { signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder, refusal } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq, inArray } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { runTeamsTick } from '../src/jobs/teams.job';
import { notifyRosterChange } from '../src/menu/teams/teams-notify';

import { conversation, deliver } from './support/conversation';
import { grantOrganizer } from './support/season';
import { teamsGame } from './support/teams-game';
import { buttonData, draftTeams, openEditor } from './support/teams-screen';
import { adminNumbered, menuTestLayer } from './support/test-layer';

const blocked = new Set<number>();
let messageId = 70_000;
const recorder = makeRecorder((method, payload) => {
    if (blocked.has(Number(payload.chat_id))) {
        throw refusal(method, 'Forbidden: bot was blocked by the user', 403);
    }

    messageId += 1;

    return method === 'sendMessage' ? { message_id: messageId, date: 0, chat: { id: payload.chat_id, type: 'private' } } : true;
});
const at = (time: string) => new Date(`2026-11-27T${time}:00Z`);
const reached = (chatId: number) =>
    recorder.calls.filter(call => call.method === 'sendMessage' && call.payload.chat_id === chatId && isDefined(call.result));

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('who gets the team proposals', it => {
    it.effect('proposes to every admin and the configured owner once, and one blocked admin never stops the others', () =>
        Effect.gen(function* () {
            const { communityId } = yield* teamsGame('teams-reach', { groupChatId: -3401, adminId: 341, players: 10 });
            yield* grantOrganizer(communityId, 342);
            yield* grantOrganizer(communityId, 343);
            blocked.add(342);
            const first = yield* runTeamsTick(at('17:05'));
            blocked.delete(342);
            const second = yield* runTeamsTick(at('17:15'));

            expect(first.proposed).toBe(1);
            expect(second.proposed).toBe(0);
            expect(reached(341)).toHaveLength(1);
            expect(reached(343)).toHaveLength(1);
            expect(reached(42)).toHaveLength(1);
            expect(reached(342)).toHaveLength(0);
        })
    );

    it.effect('claims nothing when no admin was reached and keeps the late changes until someone hears of them', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* teamsGame('teams-unreached', { groupChatId: -3402, adminId: 344, players: 10 });
            blocked.add(344);
            blocked.add(42);
            yield* runTeamsTick(at('17:05'));
            const unclaimed = yield* loadDraft(sessionId);
            blocked.delete(344);
            blocked.delete(42);
            yield* runTeamsTick(at('17:06'));
            const personId = yield* syncMember(communityId, { id: 34_499n, firstName: 'Late' }, 'active');
            yield* db.insert(signup).values({ sessionId, personId, status: 'in' });
            yield* markRosterChanged(sessionId, at('17:20'));
            blocked.add(344);
            blocked.add(42);
            const unheard = yield* notifyRosterChange(sessionId, at('17:30'));
            const kept = yield* loadDraft(sessionId);
            blocked.delete(344);
            blocked.delete(42);
            const heard = yield* notifyRosterChange(sessionId, at('17:31'));
            const [row] = yield* db.select().from(teamDraft).where(eq(teamDraft.sessionId, sessionId));

            expect(Option.getOrNull(unclaimed)?.proposedAt ?? null).toBeNull();
            expect(reached(344)).toHaveLength(2);
            expect(unheard).toBe(false);
            expect(Option.getOrNull(kept)?.state.joined).toEqual([personId]);
            expect(heard).toBe(true);
            expect(String(reached(344).at(-1)?.payload.text)).toContain('Late');
            expect(row?.notifiedAt).toEqual(at('17:31'));
        })
    );

    it.effect('clears the late changes before the note and gives its buttons the version that is stored', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* teamsGame('teams-note-version', { groupChatId: -3403, adminId: 345, players: 10 });
            yield* runTeamsTick(at('17:05'));
            const personId = yield* syncMember(communityId, { id: 34_599n, firstName: 'Later' }, 'active');
            yield* db.insert(signup).values({ sessionId, personId, status: 'in' });
            yield* markRosterChanged(sessionId, at('17:20'));
            yield* notifyRosterChange(sessionId, at('17:30'));
            const [row] = yield* db.select().from(teamDraft).where(eq(teamDraft.sessionId, sessionId));
            const note = reached(345).at(-1)?.payload.reply_markup;
            const versions = JSON.stringify(note).match(/t:[\w-]{22}:(\d+):/gu) ?? [];

            expect(versions.length).toBeGreaterThan(0);
            expect(versions.every(entry => entry.endsWith(`:${row?.version}:`))).toBe(true);
        })
    );

    it.effect('takes a squad an organizer typed in the group as the draft, stops the proposal notes and posts that squad', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId, people } = yield* teamsGame('teams-typed-squad', {
                groupChatId: -3409,
                adminId: 349,
                players: 8
            });
            const named = yield* db
                .select({ personId: person.id, alias: person.displayName })
                .from(person)
                .where(inArray(person.id, people));
            yield* db.insert(personAlias).values(
                named.map(entry => ({
                    personId: entry.personId,
                    alias: entry.alias,
                    communityId,
                    aliasNorm: entry.alias.toLowerCase(),
                    resolution: 'confirmed' as const
                }))
            );
            yield* runTeamsTick(at('17:05'));
            const [proposed] = yield* db.select().from(teamDraft).where(eq(teamDraft.sessionId, sessionId));
            yield* deliver({
                message: {
                    message_id: 9100,
                    date: Math.floor(at('17:10').getTime() / 1000),
                    chat: { id: -3409, type: 'supergroup', title: 'Games' },
                    from: { id: 349, is_bot: false, first_name: 'Admin 349' },
                    text: 'Склади: Пт 27.11 19:00\n\n🔴 Червоні · 4\nAndriy\nBohdan\nVasyl\nHryhoriy\n\n🔵 Сині · 4\nDmytro\nYevhen\nZakhar\nIvan'
                }
            });
            const [typed] = yield* db.select().from(teamDraft).where(eq(teamDraft.sessionId, sessionId));
            const admin = conversation(recorder, adminNumbered(349));
            yield* openEditor(admin);
            const { teams } = yield* draftTeams(sessionId);
            const personId = yield* syncMember(communityId, { id: 34_999n, firstName: 'Later' }, 'active');
            yield* db.insert(signup).values({ sessionId, personId, status: 'in' });
            yield* markRosterChanged(sessionId, at('17:20'));
            const noted = yield* notifyRosterChange(sessionId, at('17:30'));
            yield* admin.press(buttonData(admin.screen(), '👌 Готово'));
            yield* admin.press(buttonData(admin.screen(), '✅ Надіслати в «Games»'));
            yield* admin.press(buttonData(admin.screen(), '✅ Надіслати в «Games»'));
            const posted = String(reached(-3409).at(-1)?.payload.text);
            const red = posted.split('\n\n').find(block => block.startsWith('🔴')) ?? '';

            expect(typed?.version).toBe((proposed?.version ?? 0) + 1);
            expect(typed?.proposedAt).toBeNull();
            expect(teams.map(members => members.toSorted())).toEqual([
                ['Andriy', 'Bohdan', 'Hryhoriy', 'Vasyl'],
                ['Dmytro', 'Ivan', 'Yevhen', 'Zakhar']
            ]);
            expect(noted).toBe(false);
            expect(['Andriy', 'Bohdan', 'Vasyl', 'Hryhoriy'].every(name => red.includes(name))).toBe(true);
        })
    );
});
