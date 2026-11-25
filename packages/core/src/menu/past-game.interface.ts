import type { SessionStatus } from '../sessions/session.model';

export interface PastGame {
    readonly localDate: string;
    readonly localTime: string;
    readonly venueId: string | null;
    readonly fieldsPlanned: number | null;
    readonly capacityMax: number | null;
    readonly status: SessionStatus;
}

export interface PlannedGame {
    readonly sessionId: string;
    readonly localDate: string;
    readonly hasPoll: boolean;
}

export interface GameSize {
    readonly fields: number | null;
    readonly places: number | null;
}

export interface GamePlan extends GameSize {
    readonly localDate: string;
    readonly localTime: string;
    readonly venueId: string | null;
}

export type GameCandidate =
    | ({ readonly _tag: 'new' } & GamePlan)
    | { readonly _tag: 'announce'; readonly sessionId: string; readonly localDate: string };
