import { isDefined, isEmptyArray } from '@rnw-community/shared';

import { emptyState, place, totalCost, type SolverState } from './solver-state';

import type { HardRule } from './interface/solver.interface';
import type { SolverModel } from './solver-model';

const maxAssignments = 4096;

const countsOf = (model: SolverModel, team: readonly number[], isCounted: (player: number) => boolean): number[] =>
    Array.from({ length: model.teamCount }, (_entry, index) => team.filter((value, player) => value === index && isCounted(player)).length);

const brokenRules = (model: SolverModel, team: readonly number[]): HardRule[] => {
    const sizes = countsOf(model, team, () => true);
    const keepers = countsOf(model, team, player => model.isGk[player] === true);
    const fewest = Math.floor(model.gkTotal / model.teamCount);
    const most = Math.ceil(model.gkTotal / model.teamCount);
    const isUneven = Math.max(...sizes) - Math.min(...sizes) > 1;
    const isKeeperMiss = keepers.some(count => count < fewest || count > most);

    return [...(isUneven ? ['sizes' as const] : []), ...(isKeeperMiss ? ['keepers' as const] : [])];
};

const evenSizes = (model: SolverModel, team: number[]): void => {
    for (let step = 0; step < model.size; step += 1) {
        const sizes = countsOf(model, team, () => true);
        const largest = sizes.indexOf(Math.max(...sizes));
        const smallest = sizes.indexOf(Math.min(...sizes));
        const mover = team.findIndex(
            (value, player) => value === largest && !isDefined(model.locked[player]) && model.isGk[player] !== true
        );

        if ((sizes[largest] ?? 0) - (sizes[smallest] ?? 0) <= 1 || mover === -1) {
            return;
        }

        team[mover] = smallest;
    }
};

const stateOf = (model: SolverModel, team: readonly number[]): SolverState => {
    const state = emptyState(model);

    for (const [player, value] of team.entries()) {
        place(model, state, player, value);
    }

    return state;
};

const candidateOf = (model: SolverModel, team: readonly number[], keepers: readonly number[], code: number): number[] => {
    const next = [...team];
    let rest = code;

    for (const keeper of keepers) {
        next[keeper] = rest % model.teamCount;
        rest = Math.floor(rest / model.teamCount);
    }

    evenSizes(model, next);

    return next;
};

export const repairState = (model: SolverModel, state: SolverState): { readonly state: SolverState; readonly unresolved: HardRule[] } => {
    if (isEmptyArray(brokenRules(model, state.team))) {
        return { state, unresolved: [] };
    }

    const keepers = model.isGk.flatMap((isGk, player) => (isGk && !isDefined(model.locked[player]) ? [player] : []));
    const assignments = model.teamCount ** keepers.length;
    let best = candidateOf(model, state.team, [], 0);
    let bestCost = brokenRules(model, best).length * Number.MAX_SAFE_INTEGER;

    for (let code = 0; code < (assignments <= maxAssignments ? assignments : 0); code += 1) {
        const candidate = candidateOf(model, state.team, keepers, code);
        const misses = brokenRules(model, candidate).length;
        const cost = misses > 0 ? misses * Number.MAX_SAFE_INTEGER : totalCost(model, stateOf(model, candidate));

        if (cost < bestCost) {
            best = candidate;
            bestCost = cost;
        }
    }

    return { state: stateOf(model, best), unresolved: brokenRules(model, best) };
};
