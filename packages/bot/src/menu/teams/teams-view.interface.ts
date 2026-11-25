import type { LineupPlan } from '@rondo/core/teams/interface/publish.interface';
import type { TeamInputs } from '@rondo/core/teams/interface/team-inputs.interface';
import type { DraftRow } from '@rondo/core/teams/team-draft.service';

export interface EditorView {
    readonly row: DraftRow;
    readonly inputs: TeamInputs;
    readonly plan: LineupPlan;
    readonly waiting: readonly string[];
    readonly joinedNames: readonly string[];
    readonly leftNames: readonly string[];
    readonly selected: string | null;
    readonly page: number;
    readonly notes: readonly string[];
    // What the last send left: receipts shown, edits refused, or a refresh instead of a send
    readonly after: { readonly receipts: readonly bigint[]; readonly refused: readonly bigint[]; readonly isRefresh: boolean } | null;
    readonly offerLevels: boolean;
}
