import { isDefined } from '@rnw-community/shared';

import { pairKey } from './habits';

import type { SolverInput } from './interface/solver.interface';

export const hardWeight = 1_000_000;
export const tierStep = 5;

export interface Weights {
    readonly strength: number;
    readonly uncertainty: number;
    readonly short: number;
    readonly role: number;
    readonly habit: number;
    readonly variety: number;
    readonly host: number;
    readonly move: number;
    readonly diversity: number;
}

export const baseWeights: Weights = {
    strength: 100,
    uncertainty: 3,
    short: 60,
    role: 40,
    habit: 10,
    variety: 8,
    host: 30,
    move: 250,
    diversity: 0
};

export interface SolverModel {
    readonly size: number;
    readonly teamCount: number;
    readonly ids: readonly string[];
    readonly strength: readonly number[];
    readonly variance: readonly number[];
    readonly shortScore: readonly number[];
    readonly isGk: readonly boolean[];
    readonly roles: readonly (readonly number[])[];
    readonly roleCount: number;
    readonly locked: readonly (number | null)[];
    readonly anchor: readonly (number | null)[];
    readonly together: readonly (readonly number[])[];
    readonly pair: Float64Array;
    readonly gkTotal: number;
    readonly meanStrength: number;
    readonly weights: Weights;
}

const anchorOf = (input: SolverInput, ids: readonly string[]): (number | null)[] => {
    const teamOf = new Map<string, number>();

    for (const [team, members] of (input.anchor ?? []).entries()) {
        for (const member of members) {
            teamOf.set(member, team);
        }
    }

    return ids.map(id => teamOf.get(id) ?? null);
};

const clustersOf = (size: number, links: readonly (readonly [number, number])[]): number[][] => {
    const parent = Array.from({ length: size }, (_, index) => index);
    const root = (index: number): number => {
        let current = index;

        while (parent[current] !== current) {
            current = parent[current] ?? current;
        }

        return current;
    };

    for (const [first, second] of links) {
        parent[root(first)] = root(second);
    }

    const groups = new Map<number, number[]>();

    for (let index = 0; index < size; index += 1) {
        groups.set(root(index), [...(groups.get(root(index)) ?? []), index]);
    }

    return [...groups.values()];
};

const indexPairs = (pairs: SolverInput['together'], indexOf: ReadonlyMap<string, number>): [number, number][] =>
    pairs.flatMap(([first, second]) => {
        const left = indexOf.get(first);
        const right = indexOf.get(second);

        return !isDefined(left) || !isDefined(right) || left === right ? [] : [[left, right] satisfies [number, number]];
    });

export const buildModel = (input: SolverInput, weights: Weights, previous: readonly (readonly (readonly string[])[])[]): SolverModel => {
    const players = input.players.toSorted((left, right) => left.id.localeCompare(right.id));
    const ids = players.map(player => player.id);
    const indexOf = new Map(ids.map((id, index) => [id, index]));
    const roleNames = [...new Set(players.flatMap(player => player.roles))].toSorted();
    const size = players.length;
    const pair = new Float64Array(size * size);
    const add = (first: number, second: number, value: number): void => {
        pair[first * size + second] = (pair[first * size + second] ?? 0) + value;
        pair[second * size + first] = (pair[second * size + first] ?? 0) + value;
    };

    for (let first = 0; first < size; first += 1) {
        for (let second = first + 1; second < size; second += 1) {
            const key = pairKey(ids[first] ?? '', ids[second] ?? '');
            add(first, second, -weights.habit * (input.habits.get(key) ?? 0) + weights.variety * (input.recent.get(key) ?? 0));
        }
    }

    const together = indexPairs(input.together, indexOf);

    for (const [first, second] of together) {
        add(first, second, -hardWeight);
    }

    for (const [first, second] of indexPairs(input.apart, indexOf)) {
        add(first, second, hardWeight);
    }

    for (const [index, player] of players.entries()) {
        const host = indexOf.get(player.hostId ?? '');

        if (isDefined(host)) {
            add(index, host, -weights.host);
        }
    }

    for (const teams of previous) {
        for (const members of teams) {
            const indices = members.flatMap(member => indexOf.get(member) ?? []);

            for (const [position, first] of indices.entries()) {
                for (const second of indices.slice(position + 1)) {
                    add(first, second, weights.diversity);
                }
            }
        }
    }

    const teamCount = Math.max(1, input.teamCount);

    return {
        size,
        teamCount,
        ids,
        strength: players.map(player => player.strength),
        variance: players.map(player => player.uncertainty ** 2),
        shortScore: players.map(player => player.shortScore),
        isGk: players.map(player => player.isGk),
        roles: players.map(player => player.roles.map(role => roleNames.indexOf(role))),
        roleCount: roleNames.length,
        locked: players.map(player => {
            const team = input.locks.get(player.id);

            return isDefined(team) && team >= 0 && team < teamCount ? team : null;
        }),
        anchor: anchorOf(input, ids),
        together: clustersOf(size, together),
        pair,
        gkTotal: players.filter(player => player.isGk).length,
        meanStrength: size > 0 ? players.reduce((sum, player) => sum + player.strength, 0) / size : 0,
        weights
    };
};
