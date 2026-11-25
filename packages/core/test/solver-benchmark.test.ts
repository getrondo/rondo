import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { describe, expect, it } from 'vitest';

import { balanceTeams } from '../src/teams/balance-teams';
import { solveTeams } from '../src/teams/solve-teams';

import type { SolverPlayer } from '../src/teams/interface/solver.interface';

const randomFrom = (seed: number) => {
    let current = seed;

    return () => {
        current = (current * 48_271) % 2_147_483_647;

        return current / 2_147_483_647;
    };
};

interface Case {
    readonly players: readonly SolverPlayer[];
    readonly teamCount: number;
}

const caseOf = (seed: number): Case => {
    const random = randomFrom(seed);
    const keepers = Math.floor(random() * 4);

    return {
        teamCount: 2 + (seed % 2),
        players: Array.from({ length: 12 }, (_, index) => ({
            id: `b${String(index).padStart(2, '0')}`,
            strength: 15 + Math.round(random() * 20),
            uncertainty: 5,
            isGk: index < keepers,
            roles: [],
            hostId: null,
            shortScore: 0
        }))
    };
};

const totalsOf = (players: readonly SolverPlayer[], teams: readonly (readonly string[])[]) =>
    teams.map(team => team.reduce((sum, id) => sum + (players.find(entry => entry.id === id)?.strength ?? 0), 0));

const spreadOf = (players: readonly SolverPlayer[], teams: readonly (readonly string[])[]) => {
    const totals = totalsOf(players, teams);

    return Math.max(...totals) - Math.min(...totals);
};

const keeperMisses = (players: readonly SolverPlayer[], teams: readonly (readonly string[])[]) => {
    const keepers = players.filter(entry => entry.isGk).length;
    const counts = teams.map(team => team.filter(id => players.find(entry => entry.id === id)?.isGk === true).length);

    return counts.filter(count => count < Math.floor(keepers / teams.length) || count > Math.ceil(keepers / teams.length)).length;
};

const optimum = ({ players, teamCount }: Case) => {
    const size = players.length / teamCount;
    let best = { misses: Infinity, spread: Infinity };
    const assign = (index: number, teams: string[][]): void => {
        if (index === players.length) {
            const misses = keeperMisses(players, teams);
            const spread = spreadOf(players, teams);

            if (misses < best.misses || (misses === best.misses && spread < best.spread)) {
                best = { misses, spread };
            }

            return;
        }

        const firstEmpty = teams.findIndex(team => !isNotEmptyArray(team));

        for (const [team, members] of teams.entries()) {
            if (members.length < size && (firstEmpty === -1 || team <= firstEmpty)) {
                members.push(players[index]?.id ?? '');
                assign(index + 1, teams);
                members.pop();
            }
        }
    };
    assign(
        0,
        Array.from({ length: teamCount }, () => [])
    );

    return best;
};

const randomSplit = ({ players, teamCount }: Case, seed: number) => {
    const random = randomFrom(seed);
    const order = players.map(entry => ({ id: entry.id, key: random() })).toSorted((left, right) => left.key - right.key);

    return Array.from({ length: teamCount }, (_, team) => order.filter((_entry, index) => index % teamCount === team).map(({ id }) => id));
};

const median = (values: readonly number[]) => values.toSorted((left, right) => left - right)[Math.floor(values.length / 2)] ?? 0;

const solve = ({ players, teamCount }: Case, anchor?: readonly (readonly string[])[]) =>
    solveTeams({
        players,
        teamCount,
        locks: new Map(),
        habits: new Map(),
        recent: new Map(),
        proposals: 1,
        ...(isDefined(anchor) ? { anchor } : {})
    })[0]?.teams ?? [];

describe('solver benchmark on 12 players against the exhaustive optimum, snake draft and random', () => {
    const cases = Array.from({ length: 30 }, (_, index) => caseOf((index + 1) * 15_485_863));
    const rows = cases.map((entry, index) => {
        const best = optimum(entry);
        const ours = solve(entry);
        const snake = balanceTeams(
            entry.players.map(({ id, strength, isGk }) => ({ personId: id, displayName: id, strength, isGk })),
            entry.teamCount
        ).map(team => team.players.map(({ personId }) => personId));
        const joiner: SolverPlayer = { id: 'late', strength: 25, uncertainty: 5, isGk: false, roles: [], hostId: null, shortScore: 0 };
        const late = { ...entry, players: [...entry.players, joiner] };
        const placed = solve(late, ours);
        const moved = entry.players.filter(
            ({ id }) => ours.findIndex(team => team.includes(id)) !== placed.findIndex(team => team.includes(id))
        );
        const teamTotal = entry.players.reduce((sum, { strength }) => sum + strength, 0) / entry.teamCount;

        return {
            optimumMisses: best.misses,
            oursMisses: keeperMisses(entry.players, ours),
            snakeMisses: keeperMisses(entry.players, snake),
            gap: (spreadOf(entry.players, ours) - best.spread) / teamTotal,
            snakeGap: (spreadOf(entry.players, snake) - best.spread) / teamTotal,
            randomGap: (spreadOf(entry.players, randomSplit(entry, index + 1)) - best.spread) / teamTotal,
            moved: moved.length
        };
    });

    it('matches the optimum on the hard rules and stays within 2% of the optimal strength spread', () => {
        expect(rows.map(row => row.oursMisses - row.optimumMisses)).toEqual(rows.map(() => 0));
        expect(Math.max(...rows.map(row => row.gap))).toBeLessThanOrEqual(0.02);
        expect(rows.reduce((sum, row) => sum + row.gap, 0)).toBeLessThan(rows.reduce((sum, row) => sum + row.snakeGap, 0));
        expect(rows.reduce((sum, row) => sum + row.gap, 0)).toBeLessThan(rows.reduce((sum, row) => sum + row.randomGap, 0));
    });

    it('moves at most two placed players for one late joiner in the median', () => {
        expect(median(rows.map(row => row.moved))).toBeLessThanOrEqual(2);
    });
});
