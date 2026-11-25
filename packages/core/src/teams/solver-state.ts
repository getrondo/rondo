import { hardWeight, type SolverModel } from './solver-model';

export interface SolverState {
    readonly team: number[];
    readonly sizes: number[];
    readonly totals: number[];
    readonly variances: number[];
    readonly shorts: number[];
    readonly gks: number[];
    readonly roleCounts: number[];
    readonly link: Float64Array;
}

const addTo = (values: number[], index: number, amount: number): void => {
    values[index] = (values[index] ?? 0) + amount;
};

const addPlayer = (model: SolverModel, state: SolverState, player: number, change: readonly [number, number]): void => {
    const [team, sign] = change;
    addTo(state.sizes, team, sign);
    addTo(state.totals, team, sign * (model.strength[player] ?? 0));
    addTo(state.variances, team, sign * (model.variance[player] ?? 0));
    addTo(state.shorts, team, sign * (model.shortScore[player] ?? 0));
    addTo(state.gks, team, model.isGk[player] === true ? sign : 0);

    for (const role of model.roles[player] ?? []) {
        addTo(state.roleCounts, team * model.roleCount + role, sign);
    }
};

const shiftAggregates = (model: SolverModel, state: SolverState, player: number, route: readonly [number, number]): void => {
    addPlayer(model, state, player, [route[0], -1]);
    addPlayer(model, state, player, [route[1], 1]);
};

export const emptyState = (model: SolverModel): SolverState => ({
    team: Array.from({ length: model.size }, () => -1),
    sizes: Array.from({ length: model.teamCount }, () => 0),
    totals: Array.from({ length: model.teamCount }, () => 0),
    variances: Array.from({ length: model.teamCount }, () => 0),
    shorts: Array.from({ length: model.teamCount }, () => 0),
    gks: Array.from({ length: model.teamCount }, () => 0),
    roleCounts: Array.from({ length: model.teamCount * model.roleCount }, () => 0),
    link: new Float64Array(model.size * model.teamCount)
});

export const place = (model: SolverModel, state: SolverState, player: number, to: number): void => {
    const from = state.team[player] ?? -1;

    if (from >= 0) {
        addPlayer(model, state, player, [from, -1]);
    }

    addPlayer(model, state, player, [to, 1]);

    state.team[player] = to;

    for (let other = 0; other < model.size; other += 1) {
        const weight = other === player ? 0 : (model.pair[other * model.size + player] ?? 0);

        if (from >= 0) {
            state.link[other * model.teamCount + from] = (state.link[other * model.teamCount + from] ?? 0) - weight;
        }

        state.link[other * model.teamCount + to] = (state.link[other * model.teamCount + to] ?? 0) + weight;
    }
};

const spreadOf = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);

export const strengthSpread = (model: SolverModel, state: SolverState): number => {
    const largest = Math.max(...state.sizes);

    return spreadOf(state.totals.map((total, team) => total + (largest - (state.sizes[team] ?? 0)) * model.meanStrength));
};

const teamCost = (model: SolverModel, state: SolverState): number => {
    const largest = Math.max(...state.sizes);
    const adjusted = state.totals.map((total, team) => total + (largest - (state.sizes[team] ?? 0)) * model.meanStrength);
    const average = adjusted.reduce((sum, value) => sum + value, 0) / model.teamCount;
    const deviation = adjusted.reduce((sum, value) => sum + Math.abs(value - average), 0) / model.teamCount;
    const fewestGks = Math.floor(model.gkTotal / model.teamCount);
    const mostGks = Math.ceil(model.gkTotal / model.teamCount);
    const gkMisses = state.gks.reduce((sum, count) => sum + Math.max(0, fewestGks - count) + Math.max(0, count - mostGks), 0);
    let roleMisses = 0;

    for (let role = 0; role < model.roleCount; role += 1) {
        const counts = Array.from({ length: model.teamCount }, (_, team) => state.roleCounts[team * model.roleCount + role] ?? 0);
        const total = counts.reduce((sum, count) => sum + count, 0);
        roleMisses += Math.max(0, spreadOf(counts) - (total % model.teamCount === 0 ? 0 : 1));
    }

    const shortTotal = state.shorts.reduce((sum, value, team) => sum + ((state.sizes[team] ?? 0) < largest ? value : 0), 0);

    return (
        model.weights.strength * (spreadOf(adjusted) + deviation / 2) +
        model.weights.uncertainty * spreadOf(state.variances) +
        model.weights.short * shortTotal +
        model.weights.role * roleMisses +
        hardWeight * (gkMisses + Math.max(0, spreadOf(state.sizes) - 1))
    );
};

const seatCost = (model: SolverModel, player: number, team: number): number => model.seat[player * model.teamCount + team] ?? 0;

const linkOf = (model: SolverModel, state: SolverState, player: number, team: number): number =>
    state.link[player * model.teamCount + team] ?? 0;

export const moveDelta = (model: SolverModel, state: SolverState, player: number, to: number): number => {
    const from = state.team[player] ?? 0;
    const before = teamCost(model, state);
    shiftAggregates(model, state, player, [from, to]);
    const after = teamCost(model, state);
    shiftAggregates(model, state, player, [to, from]);

    return (
        after -
        before +
        linkOf(model, state, player, to) -
        linkOf(model, state, player, from) +
        seatCost(model, player, to) -
        seatCost(model, player, from)
    );
};

export const swapDelta = (model: SolverModel, state: SolverState, first: number, second: number): number => {
    const left = state.team[first] ?? 0;
    const right = state.team[second] ?? 0;
    const before = teamCost(model, state);
    shiftAggregates(model, state, first, [left, right]);
    shiftAggregates(model, state, second, [right, left]);
    const after = teamCost(model, state);
    shiftAggregates(model, state, second, [left, right]);
    shiftAggregates(model, state, first, [right, left]);
    const between = model.pair[first * model.size + second] ?? 0;

    return (
        after -
        before +
        linkOf(model, state, first, right) -
        linkOf(model, state, first, left) +
        linkOf(model, state, second, left) -
        linkOf(model, state, second, right) -
        2 * between +
        seatCost(model, first, right) -
        seatCost(model, first, left) +
        seatCost(model, second, left) -
        seatCost(model, second, right)
    );
};

export const totalCost = (model: SolverModel, state: SolverState): number => {
    let pairs = 0;

    for (let player = 0; player < model.size; player += 1) {
        pairs += state.link[player * model.teamCount + (state.team[player] ?? 0)] ?? 0;
        pairs += 2 * seatCost(model, player, state.team[player] ?? 0);
    }

    return teamCost(model, state) + pairs / 2;
};
