import { isDefined, isNotEmptyString } from '@rnw-community/shared';
import { describeAction } from '@rondo/core/actions/describe-action';
import { requireActionScope } from '@rondo/core/actions/execute-action';
import { proposeAction } from '@rondo/core/actions/pending-action.service';
import { suggestAliasLinks } from '@rondo/core/people/alias-links.service';
import { searchPeople, unresolvedAliases } from '@rondo/core/people/people.service';
import { gamesToReview, listSessions, listVenues, requireSession } from '@rondo/core/sessions/session.service';
import { signedUpByVotes } from '@rondo/core/signups/signed-up-by-votes';
import { rosterOf } from '@rondo/core/signups/signup.service';
import { rankings, topPlayers } from '@rondo/core/stats/participation.service';
import { communitySummary, inactivePlayers, playerHistory, venueUsage } from '@rondo/core/stats/stats.service';
import { proposeTeams } from '@rondo/core/teams/team.service';
import { tool } from 'ai';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';
import * as Schema from 'effect/Schema';

import { IsoDate, LocalTime, optionalNullable, toolSchema } from './tool-schema';
import { withCoverage } from './with-coverage';

import type { Action } from '@rondo/core/actions/action.model';
import type { Locale } from '@rondo/core/i18n/locale';
import type { Db } from '@rondo/db/service/db.service';
import type { Telegram } from '@rondo/telegram/service/telegram.service';

export interface ToolScope {
    readonly communityId: string;
    readonly tgUserId: bigint;
    readonly locale: Locale;
    readonly proposals: { actionId: string; summary: string }[];
}

export type ToolRunner = <Value, Failure>(
    effect: Effect.Effect<Value, Failure, Db | Telegram>
) => Promise<Value | { readonly error: string }>;

const Range = Schema.Struct({ from: IsoDate, to: IsoDate });
const Limit = optionalNullable(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })));
const SessionRef = Schema.Struct({ sessionId: Schema.String.annotate({ description: 'session id from list_sessions' }) });
const FieldCount = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9 }));
const PollNote = Schema.String.annotate({ description: 'extra last line of the poll, only in the words of the admin' });
const CancelReason = Schema.Literals(['weather', 'low_turnout', 'venue', 'holiday', 'organizer', 'other']);

const knownDetails = (details: {
    readonly shortName?: string | null;
    readonly station?: string | null;
    readonly address?: string | null;
    readonly district?: number | null;
    readonly indoor?: boolean | null;
}) => ({
    ...(isNotEmptyString(details.shortName) ? { shortName: details.shortName } : {}),
    ...(isNotEmptyString(details.station) ? { station: details.station } : {}),
    ...(isNotEmptyString(details.address) ? { address: details.address } : {}),
    ...(isDefined(details.district) ? { district: details.district } : {}),
    ...(isDefined(details.indoor) ? { indoor: details.indoor } : {})
});

const venueFields = {
    shortName: optionalNullable(Schema.String.annotate({ description: 'name shown in polls' })),
    station: optionalNullable(Schema.String.annotate({ description: 'nearest station as shown in polls' })),
    address: optionalNullable(Schema.String),
    district: optionalNullable(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 23 }))),
    indoor: optionalNullable(Schema.Boolean)
};

const propose = (scope: ToolScope, action: Action) =>
    Effect.gen(function* () {
        yield* requireActionScope(action, scope.communityId);
        const summary = yield* describeAction(action, scope.locale, scope.communityId);
        const actionId = yield* proposeAction({ communityId: scope.communityId, tgUserId: scope.tgUserId, action, summary });
        scope.proposals.push({ actionId, summary });

        return { status: 'awaiting_admin_confirmation', summary };
    });

const readTools = (scope: ToolScope, run: ToolRunner) => ({
    list_sessions: tool({
        description: 'List games (sessions) between two dates with id, date, time, venue, status, capacity.',
        inputSchema: toolSchema(Range),
        execute: async input => await run(listSessions(scope.communityId, input))
    }),
    session_roster: tool({
        description:
            'Who signed up for a game. signups: via the bot poll, status in/out/waitlisted and role field/gk. votes: yes votes of imported polls in time order, not proof of playing.',
        inputSchema: toolSchema(SessionRef),
        execute: async input =>
            await run(
                requireSession(scope.communityId, input.sessionId).pipe(
                    Effect.andThen(Effect.all({ signups: rosterOf(input.sessionId), votes: signedUpByVotes(input.sessionId) }))
                )
            )
    }),
    games_to_review: tool({
        description: 'Games an admin must check because it is unclear whether they were played, with the reason.',
        inputSchema: toolSchema(Schema.Struct({})),
        execute: async () => await run(gamesToReview(scope.communityId))
    }),
    top_players: tool({
        description:
            'Players ranked by one data point in a date range. by: participation (default, distinct games with a yes vote), squads (named in a posted line-up) or attendance (recorded). Never add them.',
        inputSchema: toolSchema(Schema.Struct({ ...Range.fields, by: optionalNullable(Schema.Literals(rankings)), limit: Limit })),
        execute: async input =>
            await run(
                withCoverage(
                    scope,
                    topPlayers(scope.communityId, input, { by: input.by ?? 'participation', limit: input.limit ?? 10 }),
                    input
                )
            )
    }),
    inactive_players: tool({
        description: 'Regular players (at least minGames games) who have not played since a date.',
        inputSchema: toolSchema(Schema.Struct({ notSince: IsoDate, minGames: Schema.Int, limit: Limit })),
        execute: async input =>
            await run(inactivePlayers(scope.communityId, { notSince: input.notSince, minGames: input.minGames, limit: input.limit ?? 20 }))
    }),
    venue_usage: tool({
        description: 'Games per venue in a date range, with played and cancelled counts.',
        inputSchema: toolSchema(Range),
        execute: async input => await run(venueUsage(scope.communityId, input))
    }),
    community_summary: tool({
        description: 'Totals for a date range: games, played, cancelled, distinct players, appearances.',
        inputSchema: toolSchema(Range),
        execute: async input => await run(withCoverage(scope, communitySummary(scope.communityId, input), input))
    }),
    search_people: tool({
        description: 'Find players by name, nickname or Telegram username. Returns person ids, aliases and games played.',
        inputSchema: toolSchema(Schema.Struct({ query: Schema.String })),
        execute: async input => await run(searchPeople(scope.communityId, input.query, 10))
    }),
    player_history: tool({
        description:
            'One player, total and per year, as separate data points: polls (unit polls: answered, participation yes with two or more answers, no, unreadable, reserve) and games (unit games: with a yes vote, named in a posted squad, yes and in squad, yes without any posted squad, yes but not in the posted squad, in squad without a vote or despite a no, attendance recorded). Also name and nicknames. Polls and games are different units.',
        inputSchema: toolSchema(Schema.Struct({ personId: Schema.String })),
        execute: async input => await run(withCoverage(scope, playerHistory(scope.communityId, input.personId)))
    }),
    unresolved_aliases: tool({
        description:
            'Line-up nicknames not yet confirmed as a known person, most frequent first. shared=true means several players use it. Useful to clean up duplicates.',
        inputSchema: toolSchema(Schema.Struct({ limit: Limit })),
        execute: async input => await run(unresolvedAliases(scope.communityId, input.limit ?? 20))
    }),
    suggest_alias_links: tool({
        description: 'Likely players for unlinked nicknames, from who voted in the same games. Never links anything by itself.',
        inputSchema: toolSchema(Schema.Struct({ limit: Limit })),
        execute: async input => await run(suggestAliasLinks(scope.communityId, input.limit ?? 20))
    }),
    list_venues: tool({
        description: 'Venues (fields) of the community with ids.',
        inputSchema: toolSchema(Schema.Struct({})),
        execute: async () => await run(listVenues(scope.communityId))
    })
});

const proposalTools = (scope: ToolScope, run: ToolRunner) => ({
    propose_create_session: tool({
        description: 'Propose a new game. announce=true also posts the sign-up poll in the group after confirmation.',
        inputSchema: toolSchema(
            Schema.Struct({
                localDate: IsoDate,
                localTime: LocalTime,
                venueId: optionalNullable(Schema.String),
                capacityMax: optionalNullable(Schema.Int),
                fieldsPlanned: optionalNullable(FieldCount),
                title: optionalNullable(Schema.String),
                note: optionalNullable(PollNote),
                announce: Schema.Boolean
            })
        ),
        execute: async input =>
            await run(
                propose(scope, {
                    _tag: 'create_session',
                    ...input,
                    venueId: input.venueId ?? null,
                    capacityMax: input.capacityMax ?? null,
                    fieldsPlanned: input.fieldsPlanned ?? null,
                    title: input.title ?? null
                })
            )
    }),
    propose_update_session: tool({
        description:
            'Propose rescheduling or moving a game (date, time, venue, capacity, number of fields). notify=true posts the change in the group and mentions signed-up players.',
        inputSchema: toolSchema(
            Schema.Struct({
                sessionId: Schema.String,
                localDate: optionalNullable(IsoDate),
                localTime: optionalNullable(LocalTime),
                venueId: optionalNullable(Schema.String),
                capacityMax: optionalNullable(Schema.Int),
                fieldsPlanned: optionalNullable(FieldCount),
                notify: Schema.Boolean
            })
        ),
        execute: async input =>
            await run(
                propose(scope, {
                    _tag: 'update_session',
                    sessionId: input.sessionId,
                    notify: input.notify,
                    ...(isDefined(input.localDate) ? { localDate: input.localDate } : {}),
                    ...(isDefined(input.localTime) ? { localTime: input.localTime } : {}),
                    ...(Predicate.isNotUndefined(input.venueId) ? { venueId: input.venueId } : {}),
                    ...(Predicate.isNotUndefined(input.capacityMax) ? { capacityMax: input.capacityMax } : {}),
                    ...(Predicate.isNotUndefined(input.fieldsPlanned) ? { fieldsPlanned: input.fieldsPlanned } : {})
                })
            )
    }),
    propose_cancel_session: tool({
        description: 'Propose cancelling a game with a reason. notify=true posts it in the group.',
        inputSchema: toolSchema(Schema.Struct({ sessionId: Schema.String, reason: CancelReason, notify: Schema.Boolean })),
        execute: async input => await run(propose(scope, { _tag: 'cancel_session', ...input }))
    }),
    propose_announce_session: tool({
        description: 'Propose posting the sign-up poll for an existing game in the group.',
        inputSchema: toolSchema(Schema.Struct({ ...SessionRef.fields, note: optionalNullable(PollNote) })),
        execute: async input => await run(propose(scope, { _tag: 'announce_session', ...input }))
    }),
    propose_publish_teams: tool({
        description:
            'Balance the players signed in for a game into teams (using confidential levels) and propose posting the line-ups in the group.',
        inputSchema: toolSchema(
            Schema.Struct({ sessionId: Schema.String, teamCount: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 4 })) })
        ),
        execute: async input =>
            await run(
                Effect.gen(function* () {
                    yield* requireSession(scope.communityId, input.sessionId);
                    const teams = yield* proposeTeams(input.sessionId, input.teamCount);

                    return yield* propose(scope, { _tag: 'publish_teams', sessionId: input.sessionId, teams });
                })
            )
    }),
    propose_link_alias: tool({
        description: 'Propose linking a line-up nickname (aliasId) to a player. Can be undone with propose_unlink_alias.',
        inputSchema: toolSchema(Schema.Struct({ aliasId: Schema.String, personId: Schema.String })),
        execute: async input => await run(propose(scope, { _tag: 'link_alias', ...input }))
    }),
    propose_unlink_alias: tool({
        description: 'Propose undoing the link between a line-up nickname and a player.',
        inputSchema: toolSchema(Schema.Struct({ aliasId: Schema.String })),
        execute: async input => await run(propose(scope, { _tag: 'unlink_alias', ...input }))
    }),
    propose_rename_person: tool({
        description: 'Propose changing the display name of a player.',
        inputSchema: toolSchema(Schema.Struct({ personId: Schema.String, displayName: Schema.String })),
        execute: async input => await run(propose(scope, { _tag: 'rename_person', ...input }))
    }),
    propose_grant_admin: tool({
        description:
            'Propose making a player an admin (organizer) of the community. They must have written to the bot or the group before.',
        inputSchema: toolSchema(Schema.Struct({ personId: Schema.String })),
        execute: async input => await run(propose(scope, { _tag: 'grant_admin', ...input }))
    }),
    propose_create_person: tool({
        description: 'Propose adding a player who has no Telegram. Search first; people on Telegram are added automatically.',
        inputSchema: toolSchema(Schema.Struct({ displayName: Schema.String })),
        execute: async input => await run(propose(scope, { _tag: 'create_person', ...input }))
    }),
    propose_create_venue: tool({
        description: 'Propose adding a venue (football field). Check list_venues first.',
        inputSchema: toolSchema(Schema.Struct({ name: Schema.String, ...venueFields })),
        execute: async ({ name, ...details }) => await run(propose(scope, { _tag: 'create_venue', name, ...knownDetails(details) }))
    }),
    propose_update_venue: tool({
        description:
            'Propose changing a venue: name, short name and station shown in polls, alias used in chat, address, Vienna district, indoor, or active=false to stop using it.',
        inputSchema: toolSchema(
            Schema.Struct({
                venueId: Schema.String,
                name: optionalNullable(Schema.String),
                alias: optionalNullable(Schema.String),
                active: optionalNullable(Schema.Boolean),
                ...venueFields
            })
        ),
        execute: async ({ venueId, name, alias, active, ...details }) =>
            await run(
                propose(scope, {
                    _tag: 'update_venue',
                    venueId,
                    ...knownDetails(details),
                    ...(isNotEmptyString(name) ? { name } : {}),
                    ...(isNotEmptyString(alias) ? { alias } : {}),
                    ...(isDefined(active) ? { active } : {})
                })
            )
    }),
    propose_set_level: tool({
        description: 'Propose setting a confidential player level from 1 (weak) to 10 (strong), used for team balancing.',
        inputSchema: toolSchema(
            Schema.Struct({ personId: Schema.String, level: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })) })
        ),
        execute: async input => await run(propose(scope, { _tag: 'set_rating', ...input }))
    })
});

export const buildTools = (scope: ToolScope, run: ToolRunner) => ({ ...readTools(scope, run), ...proposalTools(scope, run) });
