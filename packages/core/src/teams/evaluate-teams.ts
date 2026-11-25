import { habitsOf, pairKey } from './habits';
import { solveTeams } from './solve-teams';

import type { Evaluation, GameEvaluation, HistoryRow } from './interface/solver.interface';

const defaultStrength = 25;

const permutations = (items: readonly number[]): number[][] => {
    if (items.length <= 1) {
        return [[...items]];
    }

    const result: number[][] = [];

    for (const [index, item] of items.entries()) {
        for (const rest of permutations([...items.slice(0, index), ...items.slice(index + 1)])) {
            rest.unshift(item);
            result.push(rest);
        }
    }

    return result;
};

const sameTeamPairs = (teams: readonly (readonly string[])[]): Set<string> =>
    new Set(teams.flatMap(team => team.flatMap((first, index) => team.slice(index + 1).map(second => pairKey(first, second)))));

const fewestMoves = (proposed: readonly (readonly string[])[], actual: readonly (readonly string[])[]): number => {
    const labels = Array.from({ length: Math.max(proposed.length, actual.length) }, (_, index) => index);
    const kept = Math.max(
        ...permutations(labels).map(order =>
            order.reduce(
                (sum, target, source) => sum + (proposed[source] ?? []).filter(id => (actual[target] ?? []).includes(id)).length,
                0
            )
        )
    );

    return proposed.flat().length - kept;
};

const spreadOf = (teams: readonly (readonly string[])[], strengthOf: ReadonlyMap<string, number>): number => {
    const largest = Math.max(...teams.map(team => team.length));
    const players = teams.flat();
    const mean = players.reduce((sum, id) => sum + (strengthOf.get(id) ?? defaultStrength), 0) / Math.max(1, players.length);
    const totals = teams.map(
        team => team.reduce((sum, id) => sum + (strengthOf.get(id) ?? defaultStrength), 0) + (largest - team.length) * mean
    );

    return Math.max(...totals) - Math.min(...totals);
};

const groupBy = <Value>(values: readonly Value[], keyOf: (value: Value) => string | number): Value[][] => {
    const groups = new Map<string | number, Value[]>();

    for (const value of values) {
        groups.set(keyOf(value), [...(groups.get(keyOf(value)) ?? []), value]);
    }

    return [...groups.values()];
};

const evaluateGame = (game: readonly HistoryRow[], earlier: readonly HistoryRow[]): GameEvaluation => {
    const date = game[0]?.date ?? '';
    const ordinals = [...new Set(game.map(row => row.team))].toSorted((left, right) => left - right);
    const actual = ordinals.map(ordinal => game.filter(row => row.team === ordinal).map(row => row.player));
    const strengthOf = new Map(game.map(row => [row.player, row.strength ?? defaultStrength]));
    const { habits, recent } = habitsOf(earlier, date, new Set(strengthOf.keys()));
    const [proposal] = solveTeams({
        players: game.map(row => ({
            id: row.player,
            strength: row.strength ?? defaultStrength,
            uncertainty: 5,
            isGk: row.isGk === true,
            roles: [],
            hostId: null,
            shortScore: 0
        })),
        teamCount: ordinals.length,
        locks: new Map(),
        habits,
        recent,
        proposals: 1
    });
    const proposed = proposal?.teams ?? [];
    const truth = sameTeamPairs(actual);
    const guessed = sameTeamPairs(proposed);
    const size = game.length;

    return {
        game: game[0]?.game ?? '',
        players: size,
        pairMatch: [...truth].filter(pair => guessed.has(pair)).length,
        randomPairMatch:
            (truth.size * proposed.reduce((sum, team) => sum + team.length * (team.length - 1), 0)) / Math.max(1, size * (size - 1)),
        moves: fewestMoves(proposed, actual),
        spread: spreadOf(proposed, strengthOf),
        actualSpread: spreadOf(actual, strengthOf)
    };
};

export const evaluateTeams = (rows: readonly HistoryRow[], last = 65): Evaluation => {
    const games = groupBy(
        rows.filter(row => row.team > 0),
        row => row.game
    )
        .filter(game => new Set(game.map(row => row.team)).size >= 2)
        .toSorted(
            (left, right) =>
                (left[0]?.date ?? '').localeCompare(right[0]?.date ?? '') || (left[0]?.game ?? '').localeCompare(right[0]?.game ?? '')
        )
        .slice(-last);
    const perGame = games.map(game =>
        evaluateGame(
            game,
            rows.filter(row => row.date < (game[0]?.date ?? ''))
        )
    );
    const pairs = games.reduce(
        (sum, game) => sum + sameTeamPairs(groupBy(game, row => row.team).map(team => team.map(row => row.player))).size,
        0
    );
    const moves = perGame.map(entry => entry.moves).toSorted((left, right) => left - right);
    const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

    return {
        games: perGame.length,
        pairMatch: perGame.reduce((sum, entry) => sum + entry.pairMatch, 0) / Math.max(1, pairs),
        randomPairMatch: perGame.reduce((sum, entry) => sum + entry.randomPairMatch, 0) / Math.max(1, pairs),
        medianMoves: moves[Math.floor(moves.length / 2)] ?? 0,
        meanSpread: mean(perGame.map(entry => entry.spread)),
        meanActualSpread: mean(perGame.map(entry => entry.actualSpread)),
        perGame
    };
};
