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
    readonly habits: ReadonlyMap<string, number>;
    readonly recent: ReadonlyMap<string, number>;
    // The team of each player's home colour, where one an admin fixed goes first
    readonly homes?: ReadonlyMap<string, { readonly team: number; readonly isFixed: boolean }>;
    readonly anchor?: readonly (readonly string[])[];
    readonly proposals?: number;
}

export type ProposalReason = 'balanced' | 'usual' | 'fresh' | 'fewest';

export interface Proposal {
    readonly teams: readonly (readonly string[])[];
    readonly reason: ProposalReason;
    readonly balance: number;
    readonly moves: number;
    readonly unresolved: readonly HardRule[];
}

export type HardRule = 'sizes' | 'keepers';

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
