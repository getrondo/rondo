import { describe, expect, it } from 'vitest';

import { balanceTeams } from '../src/teams/balance-teams';

const player = (name: string, strength: number, isGk = false) => ({ personId: name, displayName: name, strength, isGk });

describe('balanceTeams', () => {
    it('splits keepers and evens out team strength', () => {
        const players = [
            player('gk1', 6, true),
            player('gk2', 4, true),
            ...[9, 8, 8, 7, 6, 5, 5, 4, 3, 2].map((strength, index) => player(`p${index}`, strength))
        ];
        const teams = balanceTeams(players, 2);
        const totals = teams.map(team => team.strength);

        expect(teams.map(team => team.players.filter(entry => entry.isGk).length)).toEqual([1, 1]);
        expect(teams.map(team => team.players.length)).toEqual([6, 6]);
        expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1);
    });

    it('keeps every player exactly once across three teams', () => {
        const players = Array.from({ length: 16 }, (_, index) => player(`p${index}`, (index % 7) + 1));
        const teams = balanceTeams(players, 3);
        const names = teams.flatMap(team => team.players.map(entry => entry.displayName)).toSorted();

        expect(names).toEqual(players.map(entry => entry.displayName).toSorted());
        expect(
            Math.max(...teams.map(team => team.players.length)) - Math.min(...teams.map(team => team.players.length))
        ).toBeLessThanOrEqual(1);
    });
});
