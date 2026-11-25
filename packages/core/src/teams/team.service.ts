import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { person } from '@rondo/db/schema/identity.schema';
import { homeColour, rating } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, isNull } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';
import { footballActivity } from '../sessions/session.service';
import { plainText } from '../utils/plain-text.util';

import { initialState, syncRoster, withChange, type DraftState } from './draft-state';
import { solveColoured } from './home-colours';
import { planLineup } from './lineup-plan';
import { publishLineup } from './publish-lineup';
import { changeDraft, coloursOf, openDraft, solverInputFor, usualTeamCount } from './team-draft.service';
import { loadTeamInputs, tierLevel } from './team-inputs';

import type { Action } from '../actions/action.model';
import type { Locale } from '../i18n/locale';
import type { GroupTarget } from '../interface/group-target.interface';
import type { BadgeColour } from './interface/badge.interface';
import type { TeamInputs, Tier } from './interface/team-inputs.interface';
import type * as Option from 'effect/Option';

export interface ProposedTeam {
    readonly ordinal: number;
    readonly players: readonly { readonly personId: string; readonly displayName: string; readonly isGk: boolean }[];
}

const solvedTeams = (inputs: TeamInputs, draftColours: readonly string[], teamCount: number | null): ProposedTeam[] => {
    const keepers = inputs.members.filter(member => member.isGk).map(member => member.personId);
    const count = teamCount ?? usualTeamCount(inputs.players.length);
    const empty = initialState({ variants: [], reasons: [], colours: [], keepers });
    const [best] = solveColoured(solverInputFor(inputs, empty, { teamCount: count, proposals: 1 }), {
        colours: coloursOf(inputs, draftColours, count),
        affinities: inputs.affinities
    });
    const nameOf = new Map(inputs.members.map(member => [member.personId, member.displayName]));

    return (best?.teams ?? []).map((members, index): ProposedTeam => ({
        ordinal: index + 1,
        players: members.map(personId => ({ personId, displayName: nameOf.get(personId) ?? '', isGk: keepers.includes(personId) }))
    }));
};

const withProposed = (inputs: TeamInputs, state: DraftState, teams: readonly ProposedTeam[]): DraftState =>
    withChange(state, {
        teams: teams.map(entry => entry.players.map(player => player.personId)),
        keepers: teams.flatMap(entry => entry.players.filter(player => player.isGk).map(player => player.personId)),
        pending: [],
        locks: [],
        colours: coloursOf(inputs, state.colours, teams.length)
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
    const teams = input.teams ?? solvedTeams(opened.inputs, opened.row.state.colours, input.teamCount);
    const plan = yield* planLineup({ ...input, loaded: opened, state: withProposed(opened.inputs, opened.row.state, teams) });
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
    const inputs = yield* loadTeamInputs(context.communityId, action.sessionId);
    const roster = inputs.members.map(member => member.personId);
    const change = yield* changeDraft(
        { sessionId: action.sessionId, version: action.version, key: 'assistant', actorPersonId: context.actorPersonId },
        state => Effect.succeed(syncRoster(withProposed(inputs, state, action.teams), roster))
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

export const setHomeColour = Effect.fn('Core.setHomeColour')(function* (input: {
    readonly personId: string;
    readonly communityId: string;
    readonly colour: BadgeColour | null;
    readonly actorPersonId: string | null;
}) {
    const db = yield* Db;
    const { personId, colour } = input;
    const activityId = yield* footballActivity(input.communityId);

    if (isDefined(colour)) {
        yield* db.transaction(() =>
            Effect.gen(function* () {
                // An erasure running at the same time waits or is seen: an erased person gets no colour
                const active = yield* db
                    .select({ id: person.id })
                    .from(person)
                    .where(and(eq(person.id, personId), isNull(person.anonymizedAt)))
                    .for('share');

                if (isNotEmptyArray(active)) {
                    yield* db
                        .insert(homeColour)
                        .values({ personId, activityId, colour })
                        .onConflictDoUpdate({ target: [homeColour.personId, homeColour.activityId], set: { colour } });
                }
            })
        );
    } else {
        yield* db.delete(homeColour).where(and(eq(homeColour.personId, personId), eq(homeColour.activityId, activityId)));
    }

    yield* recordAudit({
        communityId: input.communityId,
        actorPersonId: input.actorPersonId,
        action: 'player.home_colour',
        entityType: 'person',
        entityId: personId
    });
});
