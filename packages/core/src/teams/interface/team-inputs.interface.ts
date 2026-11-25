import type { SessionView } from '../../sessions/session.model';
import type { BadgeColour } from './badge.interface';
import type { SolverPlayer } from './solver.interface';

export type Tier = 'strong' | 'normal' | 'new';

export interface TeamMember {
    readonly personId: string;
    readonly displayName: string;
    readonly isGuest: boolean;
    readonly hostId: string | null;
    readonly isGk: boolean;
    readonly tgUserId: bigint | null;
    readonly username: string | null;
    readonly tier: Tier | null;
}

export interface TeamSettings {
    readonly leadMinutes: number;
    readonly showHandles: boolean;
}

export interface TeamInputs {
    readonly game: SessionView;
    readonly members: readonly TeamMember[];
    readonly players: readonly SolverPlayer[];
    readonly habits: ReadonlyMap<string, number>;
    readonly recent: ReadonlyMap<string, number>;
    readonly together: readonly (readonly [string, string])[];
    readonly apart: readonly (readonly [string, string])[];
    readonly hasLevels: boolean;
    readonly lastColours: readonly BadgeColour[];
    readonly settings: TeamSettings;
}
