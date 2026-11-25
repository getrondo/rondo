import { isDefined } from '@rnw-community/shared';
import { rating } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';
import { footballActivity } from '../sessions/session.service';
import { plainText } from '../utils/plain-text.util';

import { paddedColours } from './badges';
import { initialState, syncRoster, withChange, type DraftState } from './draft-state';
import { planLineup } from './lineup-plan';
import { publishLineup } from './publish-lineup';
import { solveTeams } from './solve-teams';
import { changeDraft, openDraft, solverInputFor, usualTeamCount } from './team-draft.service';
import { loadTeamInputs, tierLevel } from './team-inputs';

import type { Action } from '../actions/action.model';
import type { Locale } from '../i18n/locale';
import type { GroupTarget } from '../interface/group-target.interface';
import type { TeamInputs, Tier } from './interface/team-inputs.interface';
import type * as Option from 'effect/Option';

export interface ProposedTeam {
    readonly ordinal: number;
    readonly players: readonly { readonly personId: string; readonly displayName: string; readonly isGk: boolean }[];
}

const solvedTeams = (inputs: TeamInputs, teamCount: number | null): ProposedTeam[] => {
    const keepers = inputs.members.filter(member => member.isGk).map(member => member.personId);
    const count = teamCount ?? usualTeamCount(inputs.players.length);
    const empty = initialState({ variants: [], reasons: [], colours: [], keepers });
    const [best] = solveTeams(solverInputFor(inputs, empty, { teamCount: count, proposals: 1 }));
    const nameOf = new Map(inputs.members.map(member => [member.personId, member.displayName]));

    return (best?.teams ?? []).map((members, index): ProposedTeam => ({
        ordinal: index + 1,
        players: members.map(personId => ({ personId, displayName: nameOf.get(personId) ?? '', isGk: keepers.includes(personId) }))
    }));
};

const withProposed = (state: DraftState, teams: readonly ProposedTeam[]): DraftState =>
    withChange(state, {
        teams: teams.map(entry => entry.players.map(player => player.personId)),
        keepers: teams.flatMap(entry => entry.players.filter(player => player.isGk).map(player => player.personId)),
        pending: [],
        locks: [],
        colours: paddedColours(state.colours, teams.length)
    });

export const publishTeamsAction = Effect.fn('Core.publishTeamsAction')(function* (input: {
    readonly communityId: string;
    readonly sessionId: string;
    readonly teams: readonly ProposedTeam[] | null;
    readonly teamCount: number | null;
    readonly locale: Locale;
    readonly privateChatId: number | null;
    readonly fallback: Option.Option<GroupTarget>;
    readonly actorPersonId: string | null;
}) {
    const opened = yield* openDraft(input.communityId, input.sessionId, input.actorPersonId);
    const teams = input.teams ?? solvedTeams(opened.inputs, input.teamCount);
    const plan = yield* planLineup({ ...input, loaded: opened, state: withProposed(opened.row.state, teams) });
    const due = plan.deliveries.filter(delivery => delivery.isDue);

    return {
        _tag: 'publish_teams',
        sessionId: input.sessionId,
        teams,
        version: opened.row.version,
        fingerprint: plan.fingerprint,
        preview: {
            text: plainText(due[0]?.html ?? ''),
            to: due.map(delivery => (delivery.chatId > 0n ? null : delivery.title)),
            clearsResult: plan.clearsResult
        }
    } satisfies Action;
});

export const executePublishTeams = Effect.fn('Core.executePublishTeams')(function* (
    action: Extract<Action, { _tag: 'publish_teams' }>,
    context: {
        readonly communityId: string;
        readonly locale: Locale;
        readonly actorPersonId: string | null;
        readonly privateChatId: number | null;
        readonly fallback: Option.Option<GroupTarget>;
    }
) {
    const roster = (yield* loadTeamInputs(context.communityId, action.sessionId)).members.map(member => member.personId);
    const change = yield* changeDraft(
        { sessionId: action.sessionId, version: action.version, key: 'assistant', actorPersonId: context.actorPersonId },
        state => Effect.succeed(syncRoster(withProposed(state, action.teams), roster))
    );

    if (change._tag !== 'changed') {
        return yield* ActionFailedError.make({ failure: { code: 'lineup_changed' } });
    }

    const published = yield* publishLineup({
        ...context,
        sessionId: action.sessionId,
        version: change.row.version,
        fingerprint: action.fingerprint
    });
    const missed = published.deliveries.find(delivery => !['sent', 'edited', 'unchanged'].includes(delivery.status));

    return isDefined(missed) ? yield* ActionFailedError.make({ failure: missed.failure ?? { code: 'result_uncertain' } }) : published;
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
    yield* db
        .delete(rating)
        .where(and(eq(rating.personId, input.personId), eq(rating.activityId, activityId), eq(rating.model, 'openskill_pl')));
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
