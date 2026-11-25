export interface SolverPlayer {
    readonly id: string;
    readonly strength: number;
    readonly uncertainty: number;
    readonly isGk: boolean;
    readonly roles: readonly string[];
    readonly hostId: string | null;
    readonly shortScore: number;
}

export interface SolverInput {
    readonly players: readonly SolverPlayer[];
    readonly teamCount: number;
    readonly locks: ReadonlyMap<string, number>;
    readonly together: readonly (readonly [string, string])[];
    readonly apart: readonly (readonly [string, string])[];
    readonly habits: ReadonlyMap<string, number>;
    readonly recent: ReadonlyMap<string, number>;
    readonly anchor?: readonly (readonly string[])[];
    readonly proposals?: number;
}

export type ProposalReason = 'balanced' | 'usual' | 'fresh' | 'fewest';

export interface Proposal {
    readonly teams: readonly (readonly string[])[];
    readonly reason: ProposalReason;
    readonly balance: number;
    readonly moves: number;
}

export interface LineupRow {
    readonly game: string;
    readonly date: string;
    readonly team: number;
    readonly player: string;
}

export interface Habits {
    readonly habits: ReadonlyMap<string, number>;
    readonly recent: ReadonlyMap<string, number>;
    readonly short: ReadonlyMap<string, number>;
}

export interface HistoryRow extends LineupRow {
    readonly strength?: number;
    readonly isGk?: boolean;
}

export interface GameEvaluation {
    readonly game: string;
    readonly players: number;
    readonly pairMatch: number;
    readonly randomPairMatch: number;
    readonly moves: number;
    readonly spread: number;
    readonly actualSpread: number;
}

export interface Evaluation {
    readonly games: number;
    readonly pairMatch: number;
    readonly randomPairMatch: number;
    readonly medianMoves: number;
    readonly meanSpread: number;
    readonly meanActualSpread: number;
    readonly perGame: readonly GameEvaluation[];
}
