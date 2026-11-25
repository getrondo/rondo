import { isDefined } from '@rnw-community/shared';
import { ActionSchema, type Action } from '@rondo/core/actions/action.model';
import { proposeTeams } from '@rondo/core/teams/team.service';
import { requireVenue } from '@rondo/core/venues/venue.service';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { fromShortId } from '../../utils/from-short-id.util';

import type { MenuUser } from '../screen.interface';

const decodeAction = Schema.decodeUnknownOption(ActionSchema);
const reasonLiterals = new Set(['weather', 'low_turnout', 'venue', 'holiday', 'organizer', 'other']);

const compact = (value: string): string => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

export const changeOf = (user: MenuUser, sessionId: string, tap: { readonly op: string; readonly arg: string }): Action | null => {
    const self = String(user.tgUserId);
    const venueId = tap.op === 'vs' ? fromShortId(tap.arg) : null;
    const changes: Readonly<Record<string, () => Action | null>> = {
        p: () => ({ _tag: 'announce_session', sessionId }),
        pm: () => ({ _tag: 'announce_session', sessionId, chatId: self }),
        d: () => ({ _tag: 'delete_session', sessionId }),
        f: () => (/^-\d+$/u.test(tap.arg) ? { _tag: 'forward_poll', sessionId, chatId: tap.arg } : null),
        ts: () => ({ _tag: 'update_session', sessionId, localTime: `${tap.arg.slice(0, 2)}:${tap.arg.slice(2, 4)}`, notify: true }),
        ds: () => ({ _tag: 'update_session', sessionId, localDate: compact(tap.arg), notify: true }),
        vs: () => (isDefined(venueId) ? { _tag: 'update_session', sessionId, venueId, notify: true } : null),
        zs: () => ({ _tag: 'update_session', sessionId, capacityMax: tap.arg === '0' ? null : Number(tap.arg), notify: true }),
        xr: () =>
            reasonLiterals.has(tap.arg)
                ? Option.getOrNull(decodeAction({ _tag: 'cancel_session', sessionId, reason: tap.arg, notify: true }))
                : null
    };

    return changes[tap.op]?.() ?? null;
};

export const ownVenue = (user: MenuUser, venueId: string) => requireVenue(user.communityId, venueId).pipe(Effect.option);

export const teamsOf = Effect.fn('Bot.teamsOf')(function* (sessionId: string, count: number) {
    const teams = yield* proposeTeams(sessionId, count);
    const players = teams.reduce((total, team) => total + team.players.length, 0);

    return players >= count * 2 ? Option.some<Action>({ _tag: 'publish_teams', sessionId, teams }) : Option.none<Action>();
});
