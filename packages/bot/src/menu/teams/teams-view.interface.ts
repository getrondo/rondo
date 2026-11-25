import type { LineupPlan } from '@rondo/core/teams/interface/publish.interface';
import type { TeamInputs } from '@rondo/core/teams/interface/team-inputs.interface';
import type { DraftRow } from '@rondo/core/teams/team-draft.service';

export interface EditorView {
    readonly row: DraftRow;
    readonly inputs: TeamInputs;
    readonly plan: LineupPlan;
    readonly selected: string | null;
    readonly title: number | null;
    readonly page: number;
    readonly notes: readonly string[];
    readonly offerLevels: boolean;
}
