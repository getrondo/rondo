import { isDefined } from '@rnw-community/shared';
import { describeAction } from '@rondo/core/actions/describe-action';
import { proposeAction } from '@rondo/core/actions/pending-action.service';
import { searchPeople, unresolvedAliases } from '@rondo/core/people/people.service';
import { listSessions, listVenues } from '@rondo/core/sessions/session.service';
import { rosterOf } from '@rondo/core/signups/signup.service';
import { communitySummary, inactivePlayers, playerHistory, topAttendance, venueUsage } from '@rondo/core/stats/stats.service';
import { proposeTeams } from '@rondo/core/teams/team.service';
import { tool } from 'ai';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';
import * as Schema from 'effect/Schema';

import { IsoDate, LocalTime, optionalNullable, toolSchema } from './tool-schema';

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
const CancelReason = Schema.Literals(['weather', 'low_turnout', 'venue', 'holiday', 'organizer', 'other']);

const propose = (scope: ToolScope, action: Action) =>
    Effect.gen(function* () {
        const summary = yield* describeAction(action, scope.locale);
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
        description: 'Who signed up for a game via the bot poll: status in/out/waitlisted and role field/gk.',
        inputSchema: toolSchema(SessionRef),
        execute: async input => await run(rosterOf(input.sessionId))
    }),
    top_players: tool({
        description: 'Players ranked by number of games played in a date range.',
        inputSchema: toolSchema(Schema.Struct({ ...Range.fields, limit: Limit })),
        execute: async input => await run(topAttendance(scope.communityId, input, input.limit ?? 10))
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
        execute: async input => await run(communitySummary(scope.communityId, input))
    }),
    search_people: tool({
        description: 'Find players by name, nickname or Telegram username. Returns person ids, aliases and games played.',
        inputSchema: toolSchema(Schema.Struct({ query: Schema.String })),
        execute: async input => await run(searchPeople(scope.communityId, input.query, 10))
    }),
    player_history: tool({
        description: 'Games played, first and last game and nicknames of one player.',
        inputSchema: toolSchema(Schema.Struct({ personId: Schema.String })),
        execute: async input => await run(playerHistory(scope.communityId, input.personId))
    }),
    unresolved_aliases: tool({
        description: 'Line-up nicknames not yet confirmed as a known person, most frequent first. Useful to clean up duplicates.',
        inputSchema: toolSchema(Schema.Struct({ limit: Limit })),
        execute: async input => await run(unresolvedAliases(scope.communityId, input.limit ?? 20))
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
                title: optionalNullable(Schema.String),
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
                    title: input.title ?? null
                })
            )
    }),
    propose_update_session: tool({
        description:
            'Propose rescheduling or moving a game (date, time, venue, capacity). notify=true posts the change in the group and mentions signed-up players.',
        inputSchema: toolSchema(
            Schema.Struct({
                sessionId: Schema.String,
                localDate: optionalNullable(IsoDate),
                localTime: optionalNullable(LocalTime),
                venueId: optionalNullable(Schema.String),
                capacityMax: optionalNullable(Schema.Int),
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
                    ...(Predicate.isNotUndefined(input.capacityMax) ? { capacityMax: input.capacityMax } : {})
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
        inputSchema: toolSchema(SessionRef),
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
                    const teams = yield* proposeTeams(input.sessionId, input.teamCount);

                    return yield* propose(scope, { _tag: 'publish_teams', sessionId: input.sessionId, teams });
                })
            )
    }),
    propose_merge_people: tool({
        description:
            'Propose merging two person records that are the same human (e.g. nickname and full name). All games move to intoPersonId.',
        inputSchema: toolSchema(Schema.Struct({ fromPersonId: Schema.String, intoPersonId: Schema.String })),
        execute: async input => await run(propose(scope, { _tag: 'merge_people', ...input }))
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
    propose_set_level: tool({
        description: 'Propose setting a confidential player level from 1 (weak) to 10 (strong), used for team balancing.',
        inputSchema: toolSchema(
            Schema.Struct({ personId: Schema.String, level: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })) })
        ),
        execute: async input => await run(propose(scope, { _tag: 'set_rating', ...input }))
    })
});

export const buildTools = (scope: ToolScope, run: ToolRunner) => ({ ...readTools(scope, run), ...proposalTools(scope, run) });
