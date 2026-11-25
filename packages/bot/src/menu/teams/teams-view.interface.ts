import type { TeamInputs } from '@rondo/core/teams/interface/team-inputs.interface';
import type { DraftRow } from '@rondo/core/teams/team-draft.service';

interface TeamsAudience {
    readonly groups: readonly { readonly title: string }[];
    readonly isPrivate: boolean;
}

export interface EditorView {
    readonly row: DraftRow;
    readonly inputs: TeamInputs;
    readonly audience: TeamsAudience;
    readonly selected: string | null;
    readonly title: number | null;
    readonly page: number;
    readonly notes: readonly string[];
    readonly offerLevels: boolean;
}
