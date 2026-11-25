import { expect, layer } from '@effect/vitest';
import { syncMember } from '@rondo/core/identity/telegram-user';
import { swapPlayers } from '@rondo/core/teams/draft-state';
import { changeDraft, loadDraft, markRosterChanged, openDraft } from '@rondo/core/teams/team-draft.service';
import { claimProposal } from '@rondo/core/teams/team-schedule';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { makeRecorder } from '@rondo/telegram/testing/recording-telegram.layer';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { proposeTeamsFor, notifyRosterChange } from '../src/menu/teams/teams-notify';

import { teamsGame } from './support/teams-game';
import { menuTestLayer } from './support/test-layer';

const recorder = makeRecorder();
const at = (time: string) => new Date(`2026-11-27T${time}:00Z`);

const lateJoiner = Effect.fn('test.lateJoiner')(function* (communityId: string, sessionId: string, id: number) {
    const db = yield* Db;
    const personId = yield* syncMember(communityId, { id: BigInt(id), firstName: `Late${id}` }, 'active');
    yield* db.insert(signup).values({ sessionId, personId, status: 'in' });

    return personId;
});

layer(menuTestLayer(recorder), { timeout: 60_000, excludeTestServices: true })('when the team proposal and notes go out', it => {
    it.effect('judges the hourly check by its full hour, so a late run does not propose an hour early', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* teamsGame('teams-due-hour', { groupChatId: -3501, adminId: 351, players: 10 });
            yield* db
                .update(session)
                .set({ startsAt: at('19:10') })
                .where(eq(session.id, sessionId));
            const game = { id: sessionId, communityId, startsAt: at('19:10') };
            const late = yield* proposeTeamsFor(game, at('17:15'));
            const due = yield* proposeTeamsFor(game, at('18:05'));

            expect(late).toBe('skipped');
            expect(due).toBe('proposed');
        })
    );

    it.effect('sends late notes only after a proposal, five minutes after the later of the proposal and the last note', () =>
        Effect.gen(function* () {
            const { communityId, sessionId } = yield* teamsGame('teams-due-notes', { groupChatId: -3502, adminId: 352, players: 10 });
            yield* openDraft(communityId, sessionId, null);
            yield* lateJoiner(communityId, sessionId, 935_201);
            yield* markRosterChanged(sessionId, at('16:30'));
            const beforeProposal = yield* notifyRosterChange(sessionId, at('16:31'));
            yield* proposeTeamsFor({ id: sessionId, communityId, startsAt: at('18:00') }, at('17:00'));
            yield* lateJoiner(communityId, sessionId, 935_202);
            yield* markRosterChanged(sessionId, at('17:02'));
            const tooSoon = yield* notifyRosterChange(sessionId, at('17:03'));
            const afterPause = yield* notifyRosterChange(sessionId, at('17:06'));

            expect(beforeProposal).toBe(false);
            expect(tooSoon).toBe(false);
            expect(afterPause).toBe(true);
        })
    );

    it.effect('places players who joined since the draft was made before proposing, rebuilding a draft nobody touched', () =>
        Effect.gen(function* () {
            const untouched = yield* teamsGame('teams-due-fresh', { groupChatId: -3503, adminId: 353, players: 10 });
            yield* openDraft(untouched.communityId, untouched.sessionId, null);
            const fresh = yield* lateJoiner(untouched.communityId, untouched.sessionId, 935_301);
            yield* proposeTeamsFor({ id: untouched.sessionId, communityId: untouched.communityId, startsAt: at('18:00') }, at('17:00'));
            const rebuilt = yield* loadDraft(untouched.sessionId);
            const touched = yield* teamsGame('teams-due-touched', { groupChatId: -3504, adminId: 354, players: 10 });
            const { row } = yield* openDraft(touched.communityId, touched.sessionId, null);
            const [first = '', second = ''] = [row.state.teams[0]?.[0], row.state.teams[1]?.[0]];
            yield* changeDraft({ sessionId: touched.sessionId, version: row.version, key: 'w', actorPersonId: null }, state =>
                Effect.succeed(swapPlayers(state, first, second))
            );
            const joined = yield* lateJoiner(touched.communityId, touched.sessionId, 935_401);
            yield* proposeTeamsFor({ id: touched.sessionId, communityId: touched.communityId, startsAt: at('18:00') }, at('17:00'));
            const placed = yield* loadDraft(touched.sessionId);
            const text = String(recorder.calls.findLast(call => call.payload.chat_id === 354)?.payload.text);

            expect(Option.getOrNull(rebuilt)?.state.pending).toEqual([]);
            expect(Option.getOrNull(rebuilt)?.state.teams.flat()).toContain(fresh);
            expect(Option.getOrNull(placed)?.state.pending).toEqual([]);
            expect(Option.getOrNull(placed)?.state.teams.flat()).toContain(joined);
            expect(Option.getOrNull(placed)?.state.teams[1]).toContain(first);
            expect(text).not.toContain('🆕');
        })
    );

    it.effect('takes over a proposal nobody got after 15 minutes, and never one that reached an admin', () =>
        Effect.gen(function* () {
            const cut = yield* teamsGame('teams-due-cut', { groupChatId: -3505, adminId: 355, players: 10 });
            const game = { id: cut.sessionId, communityId: cut.communityId, startsAt: at('18:00') };
            yield* openDraft(cut.communityId, cut.sessionId, null);
            const isClaimed = yield* claimProposal(cut.sessionId, at('17:05'));
            const fresh = yield* proposeTeamsFor(game, at('17:19'));
            const stale = yield* proposeTeamsFor(game, at('17:20'));
            const reached = yield* proposeTeamsFor(game, at('17:50'));

            expect(isClaimed).toBe(true);
            expect([fresh, stale, reached]).toEqual(['skipped', 'proposed', 'skipped']);
        })
    );
});
