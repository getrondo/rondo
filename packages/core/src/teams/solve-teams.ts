import { isDefined, isNotEmptyArray } from '@rnw-community/shared';

import { baseWeights, buildModel, tierStep, type SolverModel, type Weights } from './solver-model';
import { repairState } from './solver-repair';
import { emptyState, moveDelta, place, strengthSpread, swapDelta, totalCost, type SolverState } from './solver-state';

import type { Proposal, ProposalReason, SolverInput } from './interface/solver.interface';

interface Plan {
    readonly reason: ProposalReason;
    readonly weights: Weights;
    readonly isDiverse: boolean;
}

const restarts = 6;
const maxPasses = 200;
const modulus = 2_147_483_647;

const randomFrom = (seed: number): (() => number) => {
    let current = seed % modulus || 1;

    return () => {
        current = (current * 48_271) % modulus;

        return current / modulus;
    };
};

const seedOf = (ids: readonly string[]): number =>
    Array.from(ids.join('|'), character => character.codePointAt(0) ?? 0).reduce((hash, code) => (hash * 31 + code) % modulus, 7);

const capacities = (model: SolverModel): number[] => {
    const lockedIn = Array.from({ length: model.teamCount }, (_, team) => model.locked.filter(locked => locked === team).length);
    const order = lockedIn
        .map((count, team) => ({ count, team }))
        .toSorted((left, right) => right.count - left.count || left.team - right.team);
    const base = Math.floor(model.size / model.teamCount);
    const larger = model.size % model.teamCount;
    const capacity = Array.from({ length: model.teamCount }, () => base);

    for (const { team } of order.slice(0, larger)) {
        capacity[team] = base + 1;
    }

    return capacity.map((value, team) => Math.max(value, lockedIn[team] ?? 0));
};

const pickTeam = (model: SolverModel, state: SolverState, player: number, capacity: readonly number[]): number => {
    const hasGk = model.isGk[player] === true;
    const open = capacity.map((limit, team) => ({ team, room: limit - (state.sizes[team] ?? 0) })).filter(({ room }) => room >= 1);
    const candidates = isNotEmptyArray(open) ? open : capacity.map((limit, team) => ({ team, room: limit - (state.sizes[team] ?? 0) }));
    const score = (team: number): number =>
        (hasGk ? (state.gks[team] ?? 0) * 1e9 : 0) + (state.totals[team] ?? 0) + (state.variances[team] ?? 0) / 100;

    return (
        candidates.toSorted((left, right) => score(left.team) - score(right.team) || right.room - left.room || left.team - right.team)[0]
            ?.team ?? 0
    );
};

const freeOrder = (model: SolverModel, random: (() => number) | null): number[] =>
    model.locked
        .flatMap((locked, player) =>
            isDefined(locked) ? [] : [{ player, key: isDefined(random) ? random() : -(model.strength[player] ?? 0) }]
        )
        .toSorted(
            (left, right) => Number(model.isGk[right.player] === true) - Number(model.isGk[left.player] === true) || left.key - right.key
        )
        .map(({ player }) => player);

const startFrom = (model: SolverModel, random: (() => number) | null): SolverState => {
    const state = emptyState(model);
    const capacity = capacities(model);

    for (const [player, team] of model.locked.entries()) {
        if (isDefined(team)) {
            place(model, state, player, team);
        }
    }

    const anchored = isDefined(random) ? model.anchor.map(() => null) : model.anchor;

    for (const player of freeOrder(model, random)) {
        place(model, state, player, anchored[player] ?? pickTeam(model, state, player, capacity));
    }

    return state;
};

const bestStep = (model: SolverModel, state: SolverState): readonly [number, number, number, boolean] | null => {
    let best: [number, number, number, boolean] | null = null;
    let bestDelta = -1e-6;
    const isFree = (player: number): boolean => !isDefined(model.locked[player]);

    for (let first = 0; first < model.size; first += 1) {
        if (!isFree(first)) {
            continue;
        }

        const from = state.team[first] ?? 0;

        for (let second = first + 1; second < model.size; second += 1) {
            if (isFree(second) && state.team[second] !== from) {
                const delta = swapDelta(model, state, first, second);

                if (delta < bestDelta) {
                    bestDelta = delta;
                    best = [first, second, 0, true];
                }
            }
        }

        for (let team = 0; team < model.teamCount; team += 1) {
            if (team !== from && (state.sizes[from] ?? 0) > (state.sizes[team] ?? 0)) {
                const delta = moveDelta(model, state, first, team);

                if (delta < bestDelta) {
                    bestDelta = delta;
                    best = [first, 0, team, false];
                }
            }
        }
    }

    return best;
};

const improve = (model: SolverModel, state: SolverState): void => {
    for (let pass = 0; pass < maxPasses; pass += 1) {
        const step = bestStep(model, state);

        if (!isDefined(step)) {
            return;
        }

        const [first, second, team, isSwap] = step;

        if (isSwap) {
            const firstTeam = state.team[first] ?? 0;
            place(model, state, first, state.team[second] ?? 0);
            place(model, state, second, firstTeam);
        } else {
            place(model, state, first, team);
        }
    }
};

const solveOnce = (model: SolverModel, seed: number): SolverState => {
    const random = randomFrom(seed);
    const tries = model.anchor.some(team => isDefined(team)) ? 1 : restarts;
    let bestState = emptyState(model);
    let bestCost = Infinity;

    for (let attempt = 0; attempt < tries; attempt += 1) {
        const state = startFrom(model, attempt === 0 ? null : random);
        improve(model, state);
        const cost = totalCost(model, state);

        if (cost < bestCost - 1e-9) {
            bestState = state;
            bestCost = cost;
        }
    }

    return bestState;
};

const plansFor = (input: SolverInput): Plan[] => {
    const hasLevels = new Set(input.players.map(player => player.strength)).size > 1;
    const usual = { reason: 'usual', weights: { ...baseWeights, habit: 30, diversity: 40 }, isDiverse: true } as const;
    const fresh = { reason: 'fresh', weights: { ...baseWeights, habit: 0, variety: 30, diversity: 40 }, isDiverse: true } as const;

    if (isDefined(input.anchor)) {
        return [{ reason: 'fewest', weights: baseWeights, isDiverse: false }];
    }

    return hasLevels
        ? [{ reason: 'balanced', weights: baseWeights, isDiverse: false }, usual, fresh]
        : [
              { reason: 'usual', weights: { ...baseWeights, variety: 0 }, isDiverse: false },
              fresh,
              { ...fresh, weights: { ...fresh.weights, diversity: 80 } }
          ];
};

const proposalOf = (model: SolverModel, solved: SolverState, input: SolverInput, reason: ProposalReason): Proposal => {
    const { state, unresolved } = repairState(model, solved);
    const order = new Map(input.players.map((player, index) => [player.id, index]));
    const teams = Array.from({ length: model.teamCount }, (_, team) =>
        model.ids
            .filter((_id, player) => state.team[player] === team)
            .toSorted((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0))
    );

    return {
        teams,
        reason,
        balance: Math.max(0, Math.min(1, 1 - strengthSpread(model, state) / (2 * tierStep))),
        moves: model.anchor.filter((team, player) => isDefined(team) && team !== state.team[player]).length,
        unresolved
    };
};

export const solveTeams = (input: SolverInput): Proposal[] => {
    const seed = seedOf(input.players.map(player => player.id).toSorted());
    const proposals: Proposal[] = [];

    for (const [index, plan] of plansFor(input)
        .slice(0, input.proposals ?? 3)
        .entries()) {
        const model = buildModel(input, plan.weights, plan.isDiverse ? proposals.map(proposal => proposal.teams) : []);
        proposals.push(proposalOf(model, solveOnce(model, seed + index * 7919), input, plan.reason));
    }

    return proposals;
};
