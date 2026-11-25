import { isDefined } from '@rnw-community/shared';

import { baseWeights, buildModel, tierStep, type SolverModel } from './solver-model';
import { emptyState, moveDelta, place, strengthSpread, swapDelta, type SolverState } from './solver-state';

import type { SolverInput } from './interface/solver.interface';

const stateOf = (input: SolverInput, teams: readonly (readonly string[])[]): { model: SolverModel; state: SolverState } => {
    const model = buildModel({ ...input, teamCount: teams.length }, baseWeights, []);
    const state = emptyState(model);

    for (const [team, members] of teams.entries()) {
        for (const member of members) {
            const player = model.ids.indexOf(member);

            if (player !== -1) {
                place(model, state, player, team);
            }
        }
    }

    return { model, state };
};

export const balanceOf = (input: SolverInput, teams: readonly (readonly string[])[]): number => {
    const { model, state } = stateOf(input, teams);

    return Math.max(0, Math.min(1, 1 - strengthSpread(model, state) / (2 * tierStep)));
};

export const bestSwap = (input: SolverInput, teams: readonly (readonly string[])[], personId: string): string | null => {
    const { model, state } = stateOf(input, teams);
    const first = model.ids.indexOf(personId);
    let bestId: string | null = null;
    let bestDelta = Infinity;

    if (first === -1) {
        return null;
    }

    for (let second = 0; second < model.size; second += 1) {
        const isOther = state.team[second] !== state.team[first] && (state.team[second] ?? -1) >= 0;

        if (isOther && !isDefined(model.locked[second])) {
            const delta = swapDelta(model, state, first, second);

            if (delta < bestDelta) {
                bestId = model.ids[second] ?? null;
                bestDelta = delta;
            }
        }
    }

    return bestId;
};

export const bestReturn = (
    input: SolverInput,
    teams: readonly (readonly string[])[]
): { readonly personId: string; readonly team: number } | null => {
    const sizes = teams.map(members => members.length);
    const largest = sizes.indexOf(Math.max(...sizes));
    const smallest = sizes.indexOf(Math.min(...sizes));

    if ((sizes[largest] ?? 0) - (sizes[smallest] ?? 0) < 2) {
        return null;
    }

    const { model, state } = stateOf(input, teams);
    const candidates = model.ids
        .map((id, player) => ({ id, player }))
        .filter(({ player }) => state.team[player] === largest && !isDefined(model.locked[player]))
        .map(({ id, player }) => ({ id, delta: moveDelta(model, state, player, smallest) }))
        .toSorted((left, right) => left.delta - right.delta);

    return isDefined(candidates[0]) ? { personId: candidates[0].id, team: smallest } : null;
};
