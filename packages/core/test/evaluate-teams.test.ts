import { describe, expect, it } from 'vitest';

import { habitsOf, pairKey } from '../src/teams/habits';

import { evaluateTeams } from './support/evaluate-teams';

import type { HistoryRow } from '../src/teams/interface/solver.interface';

const core = [
    ['a', 'b', 'c'],
    ['d', 'e', 'f'],
    ['g', 'h', 'i']
];

const gameRows = (index: number, teams: readonly (readonly string[])[]): HistoryRow[] =>
    teams.flatMap((team, ordinal) =>
        team.map(player => ({
            game: `g${index}`,
            date: `2026-0${1 + Math.floor(index / 28)}-${String(1 + (index % 28)).padStart(2, '0')}`,
            team: ordinal + 1,
            player
        }))
    );

describe('habits and offline evaluation', () => {
    it('scores pairs kept together above chance, pairs kept apart below and recent games more', () => {
        const rows = Array.from({ length: 12 }, (_, index) => gameRows(index, core)).flat();
        const { habits, recent } = habitsOf(rows, '2026-03-01');

        expect(habits.get(pairKey('a', 'b'))).toBeGreaterThan(1);
        expect(habits.get(pairKey('a', 'd'))).toBeLessThan(-0.3);
        expect(recent.get(pairKey('a', 'b'))).toBeCloseTo(1.75);
        expect(habitsOf(rows, '2026-01-01').habits.size).toBe(0);
    });

    it('learns fixed cores from earlier games only and reports pair match, moves and spread', () => {
        const rows = Array.from({ length: 20 }, (_, index) =>
            gameRows(index, index % 2 === 0 ? core : core.map(team => team.toReversed()))
        ).flat();
        const result = evaluateTeams(rows, 5);

        expect(result.games).toBe(5);
        expect(result.pairMatch).toBe(1);
        expect(result.randomPairMatch).toBeCloseTo(0.25);
        expect(result.medianMoves).toBe(0);
        expect(result.meanSpread).toBe(0);
        expect(result.perGame.map(entry => entry.players)).toEqual([9, 9, 9, 9, 9]);
    });
});
