import { describe, expect, it } from 'vitest';

import { pairKey } from '../src/teams/habits';
import { solveTeams } from '../src/teams/solve-teams';

import type { SolverInput, SolverPlayer } from '../src/teams/interface/solver.interface';

const randomFrom = (seed: number) => {
    let current = seed;

    return () => {
        current = (current * 48_271) % 2_147_483_647;

        return current / 2_147_483_647;
    };
};

const player = (id: string, strength = 25, extra: Partial<SolverPlayer> = {}): SolverPlayer => ({
    id,
    strength,
    uncertainty: 5,
    isGk: false,
    roles: [],
    hostId: null,
    shortScore: 0,
    ...extra
});

const inputOf = (players: readonly SolverPlayer[], teamCount: number, extra: Partial<SolverInput> = {}): SolverInput => ({
    players,
    teamCount,
    locks: new Map(),
    habits: new Map(),
    recent: new Map(),
    ...extra
});

const randomCase = (seed: number): SolverInput => {
    const random = randomFrom(seed);
    const size = 8 + Math.floor(random() * 23);
    const teamCount = 2 + Math.floor(random() * Math.min(3, Math.floor(size / 4) - 1));
    const keepers = Math.floor(random() * (teamCount + 2));
    const players = Array.from({ length: size }, (_, index) =>
        player(`p${String(index).padStart(2, '0')}`, 15 + Math.floor(random() * 20), {
            isGk: index < keepers,
            uncertainty: random() < 0.3 ? 8.3 : 5,
            roles: random() < 0.4 ? [['def', 'mid', 'fwd'][Math.floor(random() * 3)] ?? 'mid'] : []
        })
    );
    const outfield = players.filter(entry => !entry.isGk).map(entry => entry.id);
    const locks = new Map(outfield.slice(0, Math.floor(random() * teamCount)).map((id, team) => [id, team]));
    const habits = new Map(
        players.flatMap((first, index) => players.slice(index + 1).map(second => [pairKey(first.id, second.id), random() * 4 - 2] as const))
    );

    return inputOf(players, teamCount, { locks, habits });
};

const teamOf = (teams: readonly (readonly string[])[], id: string): number => teams.findIndex(team => team.includes(id));

const hardMisses = (input: SolverInput, teams: readonly (readonly string[])[]): number => {
    const sizes = teams.map(team => team.length);
    const keepers = new Set(input.players.filter(entry => entry.isGk).map(entry => entry.id));
    const gks = teams.map(team => team.filter(id => keepers.has(id)).length);
    const fewest = Math.floor(keepers.size / input.teamCount);
    const most = Math.ceil(keepers.size / input.teamCount);

    return (
        Math.max(0, Math.max(...sizes) - Math.min(...sizes) - 1) +
        gks.filter(count => count < fewest || count > most).length +
        [...input.locks].filter(([id, team]) => teamOf(teams, id) !== team).length
    );
};

describe('solveTeams', () => {
    it('repairs keepers the greedy start leaves together and names a rule the locks make impossible', () => {
        const players = Array.from({ length: 12 }, (_, index) => player(`k${index}`, index < 3 ? 40 : 20, { isGk: index < 3 }));
        const threeLocked = inputOf(players, 3, {
            locks: new Map([
                ['k3', 0],
                ['k4', 0],
                ['k5', 0]
            ])
        });
        const spread = solveTeams(threeLocked);
        const lockedKeepers = solveTeams(
            inputOf(players, 2, {
                locks: new Map([
                    ['k0', 0],
                    ['k1', 0],
                    ['k2', 0]
                ]),
                proposals: 1
            })
        );
        const lockedSizes = solveTeams(
            inputOf(players, 2, { locks: new Map(players.slice(3, 10).map(entry => [entry.id, 0])), proposals: 1 })
        );

        expect(spread.map(proposal => [hardMisses(threeLocked, proposal.teams), proposal.unresolved])).toEqual([
            [0, []],
            [0, []],
            [0, []]
        ]);
        expect(lockedKeepers.map(proposal => proposal.unresolved)).toEqual([['keepers']]);
        expect(lockedSizes.map(proposal => proposal.unresolved)).toEqual([['sizes']]);
    });

    it('always keeps the hard rules: sizes one apart, keepers spread and locks', () => {
        for (let seed = 1; seed <= 80; seed += 1) {
            const input = randomCase(seed * 7919);
            const proposals = solveTeams(input);

            for (const proposal of proposals) {
                expect({ seed, misses: hardMisses(input, proposal.teams), unresolved: proposal.unresolved }).toEqual({
                    seed,
                    misses: 0,
                    unresolved: []
                });
                expect(proposal.teams.flat().toSorted()).toEqual(input.players.map(entry => entry.id).toSorted());
            }
        }
    });

    it('gives the same teams for the same input in any order', () => {
        for (let seed = 1; seed <= 15; seed += 1) {
            const input = randomCase(seed * 104_729);
            const shuffled = { ...input, players: input.players.toReversed() };
            const sets = (proposals: ReturnType<typeof solveTeams>) =>
                proposals.map(proposal => proposal.teams.map(team => team.toSorted().join(',')));

            expect(sets(solveTeams(input))).toEqual(sets(solveTeams(input)));
            expect(sets(solveTeams(shuffled))).toEqual(sets(solveTeams(input)));
        }
    });

    it('balances 30 players into 4 teams with three different proposals in under a second', () => {
        const input = randomCase(424_242);
        const players = Array.from({ length: 30 }, (_, index) => player(`q${index}`, 15 + ((index * 7) % 20), { isGk: index < 4 }));
        const habits = new Map(
            players.flatMap((first, index) =>
                players.slice(index + 1).map(second => [pairKey(first.id, second.id), ((index % 5) - 2) / 2] as const)
            )
        );
        const started = performance.now();
        const proposals = solveTeams({ ...input, players, teamCount: 4, locks: new Map(), habits });
        const elapsed = performance.now() - started;
        const differing = (left: readonly (readonly string[])[], right: readonly (readonly string[])[]) =>
            left
                .flat()
                .filter(
                    id => !right.some(team => team.includes(id) && team.every(member => (left[teamOf(left, id)] ?? []).includes(member)))
                ).length;

        expect(elapsed).toBeLessThan(1000);
        expect(proposals.map(proposal => proposal.reason)).toEqual(['balanced', 'usual', 'fresh']);
        expect(differing(proposals[0]?.teams ?? [], proposals[1]?.teams ?? [])).toBeGreaterThan(0);
        expect(differing(proposals[1]?.teams ?? [], proposals[2]?.teams ?? [])).toBeGreaterThan(0);
    });

    it('spreads players of unknown strength, keeps guests with their host and rotates the short team', () => {
        const known = Array.from({ length: 12 }, (_, index) => player(`k${String(index).padStart(2, '0')}`));
        const unknown = Array.from({ length: 4 }, (_, index) => player(`u${index}`, 25, { uncertainty: 8.3 }));
        const [best] = solveTeams(inputOf([...known, ...unknown], 4, { proposals: 1 }));
        const host = player('host', 30);
        const guest = player('guest', 25, { hostId: 'host' });
        const field = Array.from({ length: 10 }, (_, index) => player(`f${index}`, 20 + index));
        const [hosted] = solveTeams(inputOf([host, guest, ...field], 2, { proposals: 1 }));
        const short = Array.from({ length: 13 }, (_, index) =>
            player(`s${String(index).padStart(2, '0')}`, 25, { shortScore: index < 4 ? 1 : 0 })
        );
        const [rotated] = solveTeams(inputOf(short, 2, { proposals: 1 }));
        const smaller = rotated?.teams.find(team => team.length === 6) ?? [];

        expect(best?.teams.map(team => team.filter(id => id.startsWith('u')).length)).toEqual([1, 1, 1, 1]);
        expect(teamOf(hosted?.teams ?? [], 'host')).toBe(teamOf(hosted?.teams ?? [], 'guest'));
        expect(smaller.filter(id => Number(id.slice(1)) < 4)).toEqual([]);
    });

    it('places a late joiner with the fewest moves', () => {
        const players = Array.from({ length: 12 }, (_, index) => player(`m${String(index).padStart(2, '0')}`, 18 + index));
        const [first] = solveTeams(inputOf(players, 3, { proposals: 1 }));
        const [again] = solveTeams(inputOf([...players, player('late', 25)], 3, { anchor: first?.teams ?? [] }));

        expect(again?.reason).toBe('fewest');
        expect(again?.moves).toBeLessThanOrEqual(2);
        expect(again?.teams.flat()).toContain('late');
    });

    it('ignores variety in the usual proposal without levels and keeps it for the fresh one', () => {
        const players = Array.from({ length: 12 }, (_, index) => player(`v${String(index).padStart(2, '0')}`));
        const lastGame = [players.slice(0, 6), players.slice(6)].map(team => team.map(entry => entry.id));
        const habits = new Map(
            lastGame.flatMap(team =>
                team.flatMap((first, index) => team.slice(index + 1).map(second => [pairKey(first, second), 0.5] as const))
            )
        );
        const recent = new Map(
            lastGame.flatMap(team =>
                team.flatMap((first, index) => team.slice(index + 1).map(second => [pairKey(first, second), 1] as const))
            )
        );
        const [usual, fresh] = solveTeams(inputOf(players, 2, { habits, recent }));
        const sameAsLast = (teams: readonly (readonly string[])[]) =>
            teams
                .map(team => team.toSorted().join(','))
                .toSorted()
                .join('|') ===
            lastGame
                .map(team => team.join(','))
                .toSorted()
                .join('|');

        expect(usual?.reason).toBe('usual');
        expect(sameAsLast(usual?.teams ?? [])).toBe(true);
        expect(sameAsLast(fresh?.teams ?? [])).toBe(false);
    });
});
