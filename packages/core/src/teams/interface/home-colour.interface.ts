import type { BadgeColour } from './badge.interface';
import type { LineupRow } from './solver.interface';

export interface ColouredRow extends LineupRow {
    readonly colour: BadgeColour | null;
}

export interface Affinity {
    readonly shares: ReadonlyMap<string, number>;
    readonly home: BadgeColour | null;
    readonly fixed: BadgeColour | null;
}
