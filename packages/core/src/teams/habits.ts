import { isDefined } from '@rnw-community/shared';

import type { Habits, LineupRow } from './interface/solver.interface';

const halfLifeDays = 120;
const smoothing = 1;
const recentWeights = [1, 0.5, 0.25];
const dayMs = 86_400_000;

export const pairKey = (first: string, second: string): string => (first < second ? `${first}|${second}` : `${second}|${first}`);

interface PairTally {
    weight: number;
    observed: number;
    expected: number;
}

const gamesOf = (rows: readonly LineupRow[]): LineupRow[][] => {
    const byGame = new Map<string, LineupRow[]>();

    for (const row of rows) {
        byGame.set(row.game, [...(byGame.get(row.game) ?? []), row]);
    }

    return [...byGame.values()].toSorted((left, right) => (right[0]?.date ?? '').localeCompare(left[0]?.date ?? ''));
};

const tallyGame = (
    game: readonly LineupRow[],
    weight: number,
    among: ReadonlySet<string> | null,
    tallies: Map<string, PairTally>
): void => {
    const sizes = new Map<number, number>();

    for (const row of game) {
        sizes.set(row.team, (sizes.get(row.team) ?? 0) + 1);
    }

    const others = game.length - 1;
    const players = game.filter(row => !isDefined(among) || among.has(row.player));

    for (const [index, first] of players.entries()) {
        for (const second of players.slice(index + 1)) {
            const key = pairKey(first.player, second.player);
            const chance = ((sizes.get(first.team) ?? 1) - 1 + (sizes.get(second.team) ?? 1) - 1) / 2 / Math.max(1, others);
            const tally = tallies.get(key) ?? { weight: 0, observed: 0, expected: 0 };
            tally.weight += weight;
            tally.observed += first.team === second.team ? weight : 0;
            tally.expected += weight * chance;
            tallies.set(key, tally);
        }
    }
};

const recentPairs = (games: readonly LineupRow[][], among: ReadonlySet<string> | null): Map<string, number> => {
    const recent = new Map<string, number>();

    for (const [index, game] of games.slice(0, recentWeights.length).entries()) {
        const players = game.filter(row => !isDefined(among) || among.has(row.player));

        for (const [position, first] of players.entries()) {
            for (const second of players.slice(position + 1).filter(row => row.team === first.team)) {
                const key = pairKey(first.player, second.player);
                recent.set(key, (recent.get(key) ?? 0) + (recentWeights[index] ?? 0));
            }
        }
    }

    return recent;
};

const shortPlayers = (games: readonly LineupRow[][], among: ReadonlySet<string> | null): Map<string, number> => {
    const short = new Map<string, number>();

    for (const [index, game] of games.slice(0, recentWeights.length).entries()) {
        const sizes = new Map<number, number>();

        for (const row of game) {
            sizes.set(row.team, (sizes.get(row.team) ?? 0) + 1);
        }

        const largest = Math.max(...sizes.values());

        for (const row of game.filter(entry => (sizes.get(entry.team) ?? 0) < largest && (!isDefined(among) || among.has(entry.player)))) {
            short.set(row.player, (short.get(row.player) ?? 0) + (recentWeights[index] ?? 0));
        }
    }

    return short;
};

export const habitsOf = (rows: readonly LineupRow[], today: string, among: ReadonlySet<string> | null = null): Habits => {
    const now = Date.parse(today);
    const games = gamesOf(rows.filter(row => row.date < today && row.team > 0));
    const tallies = new Map<string, PairTally>();

    for (const game of games) {
        const age = Math.max(0, (now - Date.parse(game[0]?.date ?? today)) / dayMs);
        tallyGame(game, 0.5 ** (age / halfLifeDays), among, tallies);
    }

    const habits = new Map(
        [...tallies].map(([key, { weight, observed, expected }]): [string, number] => [
            key,
            Math.log((observed + smoothing) / (weight - observed + smoothing)) -
                Math.log((expected + smoothing) / (weight - expected + smoothing))
        ])
    );

    return { habits, recent: recentPairs(games, among), short: shortPlayers(games, among) };
};
