import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { teamDraft } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { defaultColours } from './badges';
import { DraftStateSchema, initialState, playersOf, syncRoster, teamIndexOf, withChange, type DraftState } from './draft-state';
import { solveTeams } from './solve-teams';
import { loadTeamInputs } from './team-inputs';

import type { SolverInput, SolverPlayer } from './interface/solver.interface';
import type { TeamInputs } from './interface/team-inputs.interface';

const decodeState = Schema.decodeUnknownOption(DraftStateSchema);
const playersPerTeam = 6.5;

export interface DraftRow {
    readonly sessionId: string;
    readonly communityId: string;
    readonly version: number;
    readonly state: DraftState;
    readonly proposedAt: Date | null;
    readonly changedAt: Date | null;
    readonly notifiedAt: Date | null;
    readonly publishedAt: Date | null;
    readonly privateText: string | null;
}

interface DraftChange {
    readonly _tag: 'changed' | 'repeat' | 'stale';
    readonly row: DraftRow;
}

export const minimumPlayers = 8;

export const usualTeamCount = (players: number): number => Math.max(2, Math.min(6, Math.round(players / playersPerTeam)));

export const loadDraft = Effect.fn('Core.loadDraft')(function* (sessionId: string) {
    const db = yield* Db;
    const [row] = yield* db.select().from(teamDraft).where(eq(teamDraft.sessionId, sessionId));

    return Option.fromNullishOr(row).pipe(
        Option.flatMap(found => decodeState(found.state).pipe(Option.map((state): DraftRow => ({ ...found, state }))))
    );
});

const requireDraft = (sessionId: string) =>
    loadDraft(sessionId).pipe(
        Effect.flatMap(row => Effect.fromOption(row)),
        Effect.orDie
    );

export const solverInputFor = (inputs: TeamInputs, state: DraftState, extra: Partial<SolverInput> = {}): SolverInput => {
    const placed = new Set(playersOf(state));

    return {
        players: inputs.players
            .filter(player => placed.has(player.id) || !isNotEmptyArray(state.teams))
            .map((player): SolverPlayer => ({
                id: player.id,
                strength: player.strength,
                uncertainty: player.uncertainty,
                isGk: state.keepers.includes(player.id),
                roles: player.roles,
                hostId: player.hostId,
                shortScore: player.shortScore
            })),
        teamCount: Math.max(2, state.teams.length),
        locks: new Map(state.locks.map(personId => [personId, teamIndexOf(state, personId)])),
        together: inputs.together,
        apart: inputs.apart,
        habits: inputs.habits,
        recent: inputs.recent,
        ...extra
    };
};

export const freshState = (inputs: TeamInputs, teamCount: number, base: DraftState | null = null): DraftState => {
    const keepers = base?.keepers ?? inputs.members.filter(member => member.isGk).map(member => member.personId);
    const empty = initialState({ variants: [], reasons: [], colours: [], keepers });
    const proposals = solveTeams(solverInputFor(inputs, base ?? empty, { teamCount }));
    const colours = base?.colours.length === teamCount ? base.colours : defaultColours(teamCount, inputs.lastColours);
    const variants = proposals.map(proposal => proposal.teams);
    const reasons = proposals.map(proposal => proposal.reason);

    if (!isDefined(base)) {
        return initialState({ variants, reasons, colours, keepers });
    }

    return { ...withChange(base, { teams: variants[0] ?? base.teams, colours, pending: [] }, 0), variants, reasons };
};

export const rebalanced = (inputs: TeamInputs, state: DraftState): DraftState => {
    const [best] = solveTeams(solverInputFor(inputs, state, { anchor: state.teams, proposals: 1 }));

    return isDefined(best) ? withChange(state, { teams: best.teams, pending: [] }) : state;
};

export const shuffled = (inputs: TeamInputs, state: DraftState): DraftState => {
    const current = new Set(state.teams.map(team => team.toSorted().join(',')));
    const proposals = solveTeams(solverInputFor(inputs, state));
    const differing = (teams: readonly (readonly string[])[]) => teams.filter(team => !current.has(team.toSorted().join(','))).length;
    const [best] = proposals.toSorted((left, right) => differing(right.teams) - differing(left.teams));

    return isDefined(best) ? withChange(state, { teams: best.teams, pending: [] }) : state;
};

export const createDraft = Effect.fn('Core.createDraft')(function* (
    inputs: TeamInputs,
    marks: { readonly actorPersonId: string | null; readonly proposedAt: Date | null; readonly teamCount?: number }
) {
    const db = yield* Db;
    const state = freshState(inputs, marks.teamCount ?? usualTeamCount(inputs.players.length));

    yield* db
        .insert(teamDraft)
        .values({
            sessionId: inputs.game.id,
            communityId: inputs.game.communityId,
            state: yield* Schema.encodeEffect(DraftStateSchema)(state).pipe(Effect.orDie),
            proposed: state.variants,
            proposedAt: marks.proposedAt,
            updatedBy: marks.actorPersonId
        })
        .onConflictDoNothing();

    return yield* requireDraft(inputs.game.id);
});

const saveState = Effect.fn('Core.saveDraftState')(function* (
    row: DraftRow,
    state: DraftState,
    marks: { readonly actorPersonId: string | null; readonly changedAt?: Date | null }
) {
    const db = yield* Db;
    const [saved] = yield* db
        .update(teamDraft)
        .set({
            state: yield* Schema.encodeEffect(DraftStateSchema)(state).pipe(Effect.orDie),
            version: row.version + 1,
            updatedBy: marks.actorPersonId,
            ...(isDefined(marks.changedAt) ? { changedAt: marks.changedAt } : {})
        })
        .where(and(eq(teamDraft.sessionId, row.sessionId), eq(teamDraft.version, row.version)))
        .returning({ version: teamDraft.version });

    return isDefined(saved) ? Option.some<DraftRow>({ ...row, state, version: saved.version }) : Option.none<DraftRow>();
});

export const openDraft = Effect.fn('Core.openDraft')(function* (communityId: string, sessionId: string, actorPersonId: string | null) {
    const inputs = yield* loadTeamInputs(communityId, sessionId);
    const found = yield* loadDraft(sessionId);
    const row = Option.isSome(found) ? found.value : yield* createDraft(inputs, { actorPersonId, proposedAt: null });
    const synced = syncRoster(
        row.state,
        inputs.members.map(member => member.personId)
    );
    const saved = synced === row.state ? Option.fromNullishOr(row) : yield* saveState(row, synced, { actorPersonId });
    const current = Option.isSome(saved) ? saved.value : yield* requireDraft(sessionId);

    return { row: current, inputs };
});

export const changeDraft = Effect.fn('Core.changeDraft')(function* <Failure, Requirements>(
    tap: { readonly sessionId: string; readonly version: number; readonly key: string; readonly actorPersonId: string | null },
    transform: (state: DraftState) => Effect.Effect<DraftState, Failure, Requirements>
) {
    const row = yield* requireDraft(tap.sessionId);

    if (row.version !== tap.version) {
        const isRepeat = row.version === tap.version + 1 && row.state.lastTap === tap.key;

        return { _tag: isRepeat ? 'repeat' : 'stale', row } satisfies DraftChange;
    }

    const next = yield* transform(row.state);

    if (next === row.state) {
        return { _tag: 'changed', row } satisfies DraftChange;
    }

    const saved = yield* saveState(row, { ...next, lastTap: tap.key }, { actorPersonId: tap.actorPersonId });

    return Option.isSome(saved)
        ? ({ _tag: 'changed', row: saved.value } satisfies DraftChange)
        : ({
              _tag: 'stale',
              row: yield* requireDraft(tap.sessionId)
          } satisfies DraftChange);
});

export const markRosterChanged = Effect.fn('Core.markRosterChanged')(function* (sessionId: string, now: Date) {
    const db = yield* Db;

    yield* db.update(teamDraft).set({ changedAt: now }).where(eq(teamDraft.sessionId, sessionId));
});
