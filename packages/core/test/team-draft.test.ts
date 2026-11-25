import { expect, layer } from '@effect/vitest';
import { auditLog } from '@rondo/db/schema/platform.schema';
import { rating, ratingEvent, team, teamColor, teamDraft, teamMember } from '@rondo/db/schema/play.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { syncMember } from '../src/identity/telegram-user';
import { playersOf, swapPlayers, undo } from '../src/teams/draft-state';
import { planLineup } from '../src/teams/lineup-plan';
import { publishLineup } from '../src/teams/publish-lineup';
import { changeDraft, loadDraft, openDraft, rebalanced } from '../src/teams/team-draft.service';
import { recordResult } from '../src/teams/team-result';
import { setTier } from '../src/teams/team.service';
import { recordedTelegramDbLayer } from '../src/testing/recorded-telegram.layer';
import { seedGame } from '../src/testing/seed-game';

const playedGame = Effect.fn('test.playedGame')(function* (slug: string, count: number, base: number) {
    const db = yield* Db;
    const { communityId, sessionId } = yield* seedGame(slug);
    const people: string[] = [];

    for (let index = 0; index < count; index += 1) {
        const personId = yield* syncMember(communityId, { id: BigInt(base + index), firstName: `Draft${index}` }, 'active');
        yield* db.insert(signup).values({ sessionId, personId, status: 'in', role: index < 2 ? 'gk' : 'field' });
        people.push(personId);
    }

    return { communityId, sessionId, people };
});

layer(recordedTelegramDbLayer, { timeout: 60_000 })('the shared team draft', it => {
    it.effect('opens one draft per game, applies a tap once, tells a double tap from another admin and undoes', () =>
        Effect.gen(function* () {
            const { communityId, sessionId } = yield* playedGame('draft-taps', 14, 81_000);
            const { row } = yield* openDraft(communityId, sessionId, null);
            const again = yield* openDraft(communityId, sessionId, null);
            const [first = '', second = ''] = [row.state.teams[0]?.[0], row.state.teams[1]?.[0]];
            const tap = { sessionId, version: row.version, key: '1:w', actorPersonId: null };
            const swapped = yield* changeDraft(tap, state => Effect.succeed(swapPlayers(state, first, second)));
            const doubled = yield* changeDraft(tap, state => Effect.succeed(swapPlayers(state, first, second)));
            const other = yield* changeDraft({ ...tap, key: '2:w' }, state => Effect.succeed(swapPlayers(state, first, second)));
            const undone = yield* changeDraft({ ...tap, version: swapped.row.version, key: '1:u' }, state => Effect.succeed(undo(state)));

            expect(row.state.teams.map(members => members.length)).toEqual([7, 7]);
            expect(row.state.variants).toHaveLength(3);
            expect(again.row.version).toBe(row.version);
            expect(swapped._tag).toBe('changed');
            expect(swapped.row.state.teams[0]).toContain(second);
            expect(doubled._tag).toBe('repeat');
            expect(other._tag).toBe('stale');
            expect(undone.row.state.teams).toEqual(row.state.teams);
        })
    );

    it.effect('drops a player who left, keeps a joiner aside and places him with the fewest moves', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId, people } = yield* playedGame('draft-roster', 12, 82_000);
            const { row } = yield* openDraft(communityId, sessionId, null);
            yield* db
                .update(signup)
                .set({ status: 'out' })
                .where(and(eq(signup.sessionId, sessionId), eq(signup.personId, people[5] ?? '')));
            const late = yield* syncMember(communityId, { id: 82_100n, firstName: 'Late' }, 'active');
            yield* db.insert(signup).values({ sessionId, personId: late, status: 'in' });
            const reopened = yield* openDraft(communityId, sessionId, null);
            const placed = rebalanced(reopened.inputs, reopened.row.state);
            const moved = playersOf(row.state).filter(
                personId =>
                    personId !== people[5] &&
                    row.state.teams.findIndex(members => members.includes(personId)) !==
                        placed.teams.findIndex(members => members.includes(personId))
            );

            expect(reopened.row.state.pending).toEqual([late]);
            expect(reopened.row.state.joined).toEqual([late]);
            expect(reopened.row.state.left).toEqual([people[5]]);
            expect(playersOf(reopened.row.state)).not.toContain(people[5]);
            expect(placed.pending).toEqual([]);
            expect(placed.teams.flat()).toContain(late);
            expect(moved.length).toBeLessThanOrEqual(1);
        })
    );

    it.effect('stores the one-tap result per team, updates strength confidentially and lets the same evening correct it once', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId, people } = yield* playedGame('draft-result', 10, 83_000);
            yield* setTier({ communityId, personId: people[3] ?? '', tier: 'strong', actorPersonId: null });
            yield* openDraft(communityId, sessionId, null);
            const input = {
                communityId,
                sessionId,
                locale: 'uk' as const,
                actorPersonId: null,
                privateChatId: null,
                fallback: Option.some({ chatId: -830n, topicId: null })
            };
            const plan = yield* planLineup(input);
            yield* publishLineup({
                ...input,
                version: plan.version,
                fingerprint: plan.fingerprint
            });
            const evening = new Date('2026-12-04T20:30:00Z');
            const ranks = yield* recordResult({ communityId, sessionId, winner: 1, actorPersonId: null, now: evening });
            const corrected = yield* recordResult({ communityId, sessionId, winner: 2, actorPersonId: null, now: evening });
            const twice = yield* recordResult({
                communityId,
                sessionId,
                winner: 1,
                actorPersonId: null,
                now: new Date('2026-12-05T08:00:00Z')
            }).pipe(Effect.flip);
            const stored = yield* db.select({ rank: team.rank }).from(team).where(eq(team.sessionId, sessionId)).orderBy(asc(team.ordinal));
            const learned = yield* db.select().from(rating).where(eq(rating.model, 'openskill_pl'));
            const events = yield* db.select().from(ratingEvent).where(eq(ratingEvent.sessionId, sessionId));
            const [audit] = yield* db
                .select({ diff: auditLog.diff })
                .from(auditLog)
                .where(and(eq(auditLog.entityId, sessionId), eq(auditLog.action, 'teams.result')));

            expect(ranks).toEqual({ ranks: [1, 2], isCorrection: false });
            expect(corrected).toEqual({ ranks: [2, 1], isCorrection: true });
            expect(stored.map(row => row.rank)).toEqual([2, 1]);
            expect(learned.filter(row => people.includes(row.personId)).map(row => row.games)).toEqual(Array.from({ length: 10 }, () => 1));
            expect(twice._tag).toBe('ActionFailedError');
            expect(learned.filter(row => people.includes(row.personId))).toHaveLength(10);
            expect(events).toHaveLength(10);
            expect(events.filter(event => event.muAfter > event.muBefore)).toHaveLength(5);
            expect(audit?.diff).toEqual({ winner: 1, isCorrection: false });
        })
    );

    it.effect('starts a new draft from the stored teams, their colours and keepers, and places the rest with the fewest moves', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId, people } = yield* playedGame('draft-seeded', 9, 85_000);
            const [green] = yield* db.insert(teamColor).values({ communityId, name: 'green', emoji: '🟢' }).returning({ id: teamColor.id });
            const [yellow] = yield* db
                .insert(teamColor)
                .values({ communityId, name: 'yellow', emoji: '🟡' })
                .returning({ id: teamColor.id });
            const stored = [people.slice(0, 4), people.slice(4, 8)];

            for (const [index, members] of stored.entries()) {
                const [row] = yield* db
                    .insert(team)
                    .values({ sessionId, ordinal: index + 1, colorId: index === 0 ? green?.id : yellow?.id })
                    .returning({ id: team.id });
                yield* db
                    .insert(teamMember)
                    .values(members.map(personId => ({ teamId: row?.id ?? '', sessionId, personId, isGk: personId === people[5] })));
            }

            const { row } = yield* openDraft(communityId, sessionId, null);

            expect(row.state.colours).toEqual(['green', 'yellow']);
            expect(row.state.keepers).toEqual([people[5]]);
            expect(row.state.pending).toEqual([]);
            expect(row.state.teams[0]).toEqual(expect.arrayContaining(stored[0] ?? []));
            expect(row.state.teams[1]).toEqual(expect.arrayContaining(stored[1] ?? []));
            expect(row.state.teams.flat()).toContain(people[8]);
        })
    );

    it.effect('gives every team a colour of its own even when the stored draft has fewer colours than teams', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* playedGame('draft-colours', 18, 86_000);
            const { row } = yield* openDraft(communityId, sessionId, null);
            yield* db
                .update(teamDraft)
                .set({
                    state: {
                        ...row.state,
                        teams: [row.state.teams.flat().slice(0, 6), row.state.teams.flat().slice(6, 12), row.state.teams.flat().slice(12)],
                        colours: ['blue']
                    }
                })
                .where(eq(teamDraft.sessionId, sessionId));
            const loaded = yield* loadDraft(sessionId);

            expect(Option.getOrNull(loaded)?.state.colours).toEqual(['blue', 'red', 'green']);
        })
    );

    it.effect(
        'rates the posted members, reverts the result even when the teams were stored again, and lets a tier replace a learned rating',
        () =>
            Effect.gen(function* () {
                const db = yield* Db;
                const { communityId, sessionId, people } = yield* playedGame('draft-rated', 10, 87_000);
                yield* openDraft(communityId, sessionId, null);
                const input = {
                    communityId,
                    sessionId,
                    locale: 'uk' as const,
                    actorPersonId: null,
                    privateChatId: null,
                    fallback: Option.some({ chatId: -870n, topicId: null })
                };
                const plan = yield* planLineup(input);
                yield* publishLineup({ ...input, version: plan.version, fingerprint: plan.fingerprint });
                const [game] = yield* db.select({ activityId: session.activityId }).from(session).where(eq(session.id, sessionId));
                const absent = people[9] ?? '';
                yield* db
                    .insert(rating)
                    .values({ personId: absent, activityId: game?.activityId ?? '', model: 'openskill_pl', mu: 40, sigma: 2, games: 30 });
                yield* db
                    .update(signup)
                    .set({ status: 'out' })
                    .where(and(eq(signup.sessionId, sessionId), eq(signup.personId, absent)));
                const evening = new Date('2026-12-04T20:30:00Z');
                yield* recordResult({ communityId, sessionId, winner: 1, actorPersonId: null, now: evening });
                const [event] = yield* db
                    .select()
                    .from(ratingEvent)
                    .where(and(eq(ratingEvent.sessionId, sessionId), eq(ratingEvent.personId, absent)));
                yield* db.update(team).set({ rank: null }).where(eq(team.sessionId, sessionId));
                const again = yield* recordResult({ communityId, sessionId, winner: 1, actorPersonId: null, now: evening });
                const events = yield* db.select().from(ratingEvent).where(eq(ratingEvent.sessionId, sessionId));
                const [games] = yield* db
                    .select({ games: rating.games })
                    .from(rating)
                    .where(and(eq(rating.personId, absent), eq(rating.model, 'openskill_pl')));
                yield* setTier({ communityId, personId: absent, tier: 'new', actorPersonId: null });
                const learned = yield* db
                    .select()
                    .from(rating)
                    .where(and(eq(rating.personId, absent), eq(rating.model, 'openskill_pl')));

                expect(event?.muBefore).toBe(40);
                expect(again.isCorrection).toBe(true);
                expect(events).toHaveLength(10);
                expect(games?.games).toBe(31);
                expect(learned).toEqual([]);
            })
    );
});
