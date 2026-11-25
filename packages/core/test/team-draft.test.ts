import { expect, layer } from '@effect/vitest';
import { telegramAccount, telegramAuthor } from '@rondo/db/schema/identity.schema';
import { auditLog, telegramPoll } from '@rondo/db/schema/platform.schema';
import { lineupEntry, rating, ratingEvent, team, teamColor, teamDraft, teamMember } from '@rondo/db/schema/play.schema';
import { session, signup } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { syncMember } from '../src/identity/telegram-user';
import { addGuests } from '../src/signups/roster.service';
import { playersOf, swapPlayers, undo } from '../src/teams/draft-state';
import { storedTeams } from '../src/teams/lineup-of-draft';
import { planLineup } from '../src/teams/lineup-plan';
import { publishLineup } from '../src/teams/publish-lineup';
import { changeDraft, loadDraft, openDraft, rebalanced } from '../src/teams/team-draft.service';
import { membersOf } from '../src/teams/team-inputs';
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

// A squad imported from a chat: two teams, players alternating between them
const importSquad = Effect.fn('test.importSquad')(function* (sessionId: string, players: readonly string[]) {
    const db = yield* Db;
    yield* db.insert(team).values([1, 2].map(ordinal => ({ sessionId, ordinal })));
    yield* db.insert(lineupEntry).values(
        players.map((personId, index) => ({
            sessionId,
            messageId: 1,
            teamOrdinal: (index % 2) + 1,
            position: index + 1,
            personId,
            resolvedBy: 'manual' as const
        }))
    );
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

    it.effect('mentions the account seen in the community chat, else the only account, else nobody', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId, people } = yield* playedGame('draft-mentions', 3, 88_000);
            const [game] = yield* db.select({ activityId: session.activityId }).from(session).where(eq(session.id, sessionId));
            yield* db.insert(telegramAccount).values([
                { tgUserId: 88_100n, personId: people[0], firstName: 'Second', lastSeenAt: new Date('2026-12-01T00:00:00Z') },
                { tgUserId: 88_101n, personId: people[1], firstName: 'Second', lastSeenAt: new Date('2026-12-01T00:00:00Z') }
            ]);
            yield* db
                .update(telegramAccount)
                .set({ lastSeenAt: new Date('2026-11-01T00:00:00Z') })
                .where(eq(telegramAccount.tgUserId, 88_000n));
            yield* db.insert(telegramAuthor).values({
                communityId,
                displayName: 'Draft0',
                tgUserId: 88_000n,
                personId: people[0],
                firstSeenAt: new Date('2026-10-01T00:00:00Z'),
                lastSeenAt: new Date('2026-11-01T00:00:00Z')
            });
            const { members } = yield* membersOf(sessionId, game?.activityId ?? '');
            const accountOf = (personId: string | undefined) => members.find(member => member.personId === personId)?.tgUserId ?? null;

            expect(accountOf(people[0])).toBe(88_000n);
            expect(accountOf(people[1])).toBeNull();
            expect(accountOf(people[2])).toBe(88_002n);
        })
    );

    it.effect('records the result of an imported line-up from its entries and offers none without a squad', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId, people } = yield* playedGame('draft-imported', 4, 89_000);
            yield* db.insert(team).values([1, 2].map(ordinal => ({ sessionId, ordinal })));
            const empty = yield* storedTeams(sessionId);
            yield* db.insert(lineupEntry).values([
                ...people.map((personId, index) => ({
                    sessionId,
                    messageId: 1,
                    teamOrdinal: (index % 2) + 1,
                    position: index + 1,
                    personId,
                    resolvedBy: 'manual' as const
                })),
                {
                    sessionId,
                    messageId: 1,
                    teamOrdinal: 1,
                    position: 9,
                    guestOfPersonId: people[0],
                    isGuest: true,
                    resolvedBy: 'manual' as const
                }
            ]);
            const shown = yield* storedTeams(sessionId);
            yield* recordResult({ communityId, sessionId, winner: 1, actorPersonId: null, now: new Date('2026-12-04T20:30:00Z') });
            const events = yield* db
                .select({ personId: ratingEvent.personId })
                .from(ratingEvent)
                .where(eq(ratingEvent.sessionId, sessionId));

            expect(empty).toEqual([]);
            expect(shown).toHaveLength(2);
            expect(events.map(event => event.personId).toSorted()).toEqual([...people].toSorted());
        })
    );

    it.effect('starts the draft of an imported line-up from its entries', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId, people } = yield* playedGame('draft-from-import', 8, 89_500);
            yield* db.insert(team).values([1, 2].map(ordinal => ({ sessionId, ordinal })));
            yield* db.insert(lineupEntry).values(
                people.map((personId, index) => ({
                    sessionId,
                    messageId: 1,
                    teamOrdinal: index < 4 ? 1 : 2,
                    position: index + 1,
                    personId,
                    resolvedBy: 'manual' as const
                }))
            );
            const { row } = yield* openDraft(communityId, sessionId, null);

            expect(row.state.teams.map(members => members.toSorted())).toEqual([people.slice(0, 4).toSorted(), people.slice(4).toSorted()]);
        })
    );

    it.effect('seeds squad members who never signed up and leaves out those whose sign-up is out', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId, people } = yield* playedGame('draft-unsigned', 8, 89_800);
            const loose = yield* syncMember(communityId, { id: 89_810n, firstName: 'Loose' }, 'active');
            const gone = yield* syncMember(communityId, { id: 89_811n, firstName: 'Gone' }, 'active');
            yield* db.insert(signup).values({ sessionId, personId: gone, status: 'out', role: 'field' });
            yield* importSquad(sessionId, [...people, loose, gone]);
            const { row } = yield* openDraft(communityId, sessionId, null);
            const placed = row.state.teams.flat();

            expect(placed).toContain(loose);
            expect(placed).not.toContain(gone);
            expect(placed).toHaveLength(9);
        })
    );

    it.effect('seeds a squad member without a sign-up only when the game never had a bot poll', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId, people } = yield* playedGame('draft-unsigned-poll', 8, 89_950);
            const loose = yield* syncMember(communityId, { id: 89_960n, firstName: 'Loose' }, 'active');
            yield* db
                .insert(telegramPoll)
                .values({ pollId: 'poll-unsigned', chatId: -1n, messageId: 1, sessionId, options: ['in', 'out'] });
            yield* importSquad(sessionId, [...people, loose]);
            const { row } = yield* openDraft(communityId, sessionId, null);

            expect(row.state.teams.flat()).not.toContain(loose);
            expect(row.state.teams.flat()).toHaveLength(8);
        })
    );

    it.effect('lets a squad member without a sign-up bring a guest', () =>
        Effect.gen(function* () {
            const { communityId, sessionId, people } = yield* playedGame('draft-unsigned-host', 8, 89_970);
            const loose = yield* syncMember(communityId, { id: 89_980n, firstName: 'Loose' }, 'active');
            yield* importSquad(sessionId, [...people, loose]);
            const added = yield* addGuests({ communityId, sessionId, actorPersonId: null }, { hostPersonId: loose, count: 1, name: null });

            expect(added).toHaveLength(1);
        })
    );

    it.effect('adds a goalkeeper who voted after the draft was made to the keepers', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* playedGame('draft-late-keeper', 8, 89_990);
            yield* openDraft(communityId, sessionId, null);
            const keeper = yield* syncMember(communityId, { id: 89_999n, firstName: 'Late keeper' }, 'active');
            yield* db.insert(signup).values({ sessionId, personId: keeper, status: 'in', role: 'gk' });
            const { row } = yield* openDraft(communityId, sessionId, null);

            expect(row.state.keepers).toContain(keeper);
        })
    );

    it.effect('records a result only after the kick-off, for a game that is on and for a team of its squad', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const { communityId, sessionId } = yield* playedGame('draft-result-checks', 8, 89_700);
            const { row } = yield* openDraft(communityId, sessionId, null);
            const input = {
                communityId,
                sessionId,
                locale: 'uk' as const,
                actorPersonId: null,
                privateChatId: null,
                fallback: Option.some({ chatId: -897n, topicId: null })
            };
            const plan = yield* planLineup(input);
            yield* publishLineup({ ...input, version: row.version, fingerprint: plan.fingerprint });
            const early = yield* recordResult({
                communityId,
                sessionId,
                winner: 1,
                actorPersonId: null,
                now: new Date('2026-12-04T17:00:00Z')
            }).pipe(Effect.flip);
            const unknown = yield* recordResult({
                communityId,
                sessionId,
                winner: 5,
                actorPersonId: null,
                now: new Date('2026-12-04T20:30:00Z')
            }).pipe(Effect.flip);
            yield* db.update(session).set({ status: 'cancelled' }).where(eq(session.id, sessionId));
            const cancelled = yield* recordResult({
                communityId,
                sessionId,
                winner: 1,
                actorPersonId: null,
                now: new Date('2026-12-04T20:30:00Z')
            }).pipe(Effect.flip);

            expect(early).toMatchObject({ reason: 'the game has not started yet' });
            expect(unknown).toMatchObject({ reason: 'the game has no such team' });
            expect(cancelled).toMatchObject({ reason: 'the game is already over or cancelled' });
        })
    );
});
