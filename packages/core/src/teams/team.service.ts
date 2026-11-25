import { rating, teamDraft } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { recordAudit } from '../audit/record-audit';
import { footballActivity } from '../sessions/session.service';

import { DraftStateSchema, initialState, withChange } from './draft-state';
import { solveTeams } from './solve-teams';
import { createDraft, loadDraft, solverInputFor, usualTeamCount } from './team-draft.service';
import { loadTeamInputs, tierLevel } from './team-inputs';

import type { Tier } from './interface/team-inputs.interface';

export interface ProposedTeam {
    readonly ordinal: number;
    readonly players: readonly { readonly personId: string; readonly displayName: string; readonly isGk: boolean }[];
}

export const proposeTeams = Effect.fn('Core.proposeTeams')(function* (communityId: string, sessionId: string, teamCount: number | null) {
    const inputs = yield* loadTeamInputs(communityId, sessionId);
    const keepers = inputs.members.filter(member => member.isGk).map(member => member.personId);
    const count = teamCount ?? usualTeamCount(inputs.players.length);
    const empty = initialState({ variants: [], reasons: [], colours: [], keepers });
    const [best] = solveTeams(solverInputFor(inputs, empty, { teamCount: count, proposals: 1 }));
    const nameOf = new Map(inputs.members.map(member => [member.personId, member.displayName]));

    return (best?.teams ?? []).map((members, index): ProposedTeam => ({
        ordinal: index + 1,
        players: members.map(personId => ({ personId, displayName: nameOf.get(personId) ?? '', isGk: keepers.includes(personId) }))
    }));
});

export const storeProposedTeams = Effect.fn('Core.storeProposedTeams')(function* (
    communityId: string,
    sessionId: string,
    teams: readonly ProposedTeam[],
    actorPersonId: string | null
) {
    const db = yield* Db;
    const inputs = yield* loadTeamInputs(communityId, sessionId);
    const found = yield* loadDraft(sessionId);
    const row = Option.isSome(found)
        ? found.value
        : yield* createDraft(inputs, { actorPersonId, proposedAt: null, teamCount: teams.length });
    const placed = teams.map(entry => entry.players.map(player => player.personId));
    const keepers = teams.flatMap(entry => entry.players.filter(player => player.isGk).map(player => player.personId));
    const colours = row.state.colours.length === placed.length ? row.state.colours : row.state.colours.slice(0, placed.length);
    const state = withChange(row.state, { teams: placed, keepers, pending: [], locks: [], colours });

    yield* db
        .update(teamDraft)
        .set({
            state: yield* Schema.encodeEffect(DraftStateSchema)(state).pipe(Effect.orDie),
            version: row.version + 1,
            updatedBy: actorPersonId
        })
        .where(eq(teamDraft.sessionId, sessionId));
});

export const setSeedRating = Effect.fn('Core.setSeedRating')(function* (input: {
    readonly personId: string;
    readonly communityId: string;
    readonly level: number;
    readonly actorPersonId: string | null;
}) {
    const db = yield* Db;
    const activityId = yield* footballActivity(input.communityId);

    yield* db
        .insert(rating)
        .values({ personId: input.personId, activityId, model: 'organizer_seed', mu: input.level, sigma: 0 })
        .onConflictDoUpdate({ target: [rating.personId, rating.activityId, rating.model], set: { mu: input.level } });
    yield* recordAudit({
        communityId: input.communityId,
        actorPersonId: input.actorPersonId,
        action: 'rating.seed',
        entityType: 'person',
        entityId: input.personId
    });
});

export const setTier = (input: {
    readonly personId: string;
    readonly communityId: string;
    readonly tier: Tier;
    readonly actorPersonId: string | null;
}) => setSeedRating({ ...input, level: tierLevel(input.tier) });
