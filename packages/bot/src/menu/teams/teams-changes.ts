import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { addGuests, joinGame, removeFromGame } from '@rondo/core/signups/roster.service';
import { badges } from '@rondo/core/teams/badges';
import {
    movePlayers,
    pickVariant,
    playersOf,
    setColour,
    swapPlayers,
    syncByAdmin,
    teamIndexOf,
    toggleKeeper,
    toggleLock,
    undo,
    type DraftState
} from '@rondo/core/teams/draft-state';
import { changeDraft, freshState, rebalanced, shuffled } from '@rondo/core/teams/team-draft.service';
import { loadTeamInputs } from '@rondo/core/teams/team-inputs';
import * as Effect from 'effect/Effect';

import { fromShortId } from '../../utils/from-short-id.util';

import type { MenuUser } from '../screen.interface';
import type { TeamsTap } from './teams-callback';
import type { TeamInputs } from '@rondo/core/teams/interface/team-inputs.interface';

const guestsWith = (state: DraftState, inputs: TeamInputs, hostId: string): string[] => {
    const team = teamIndexOf(state, hostId);

    return inputs.members
        .filter(member => member.isGuest && member.hostId === hostId && teamIndexOf(state, member.personId) === team)
        .map(member => member.personId);
};

export const hostGuestsInTeam = guestsWith;

interface ChangeContext {
    readonly user: MenuUser;
    readonly tap: TeamsTap;
    readonly inputs: TeamInputs;
    readonly actorPersonId: string | null;
}

const swapOrPlace = (state: DraftState, first: string, second: string): DraftState => {
    if (state.pending.includes(first) && state.pending.includes(second)) {
        return state;
    }

    if (state.pending.includes(first)) {
        return movePlayers(state, [first], teamIndexOf(state, second));
    }

    return state.pending.includes(second) ? movePlayers(state, [second], teamIndexOf(state, first)) : swapPlayers(state, first, second);
};

const afterRoster = (context: ChangeContext, state: DraftState, place: (synced: DraftState, inputs: TeamInputs) => DraftState) =>
    loadTeamInputs(context.user.communityId, context.tap.sessionId).pipe(
        Effect.map(inputs => ({
            ...place(
                syncByAdmin(
                    state,
                    inputs.members.map(member => member.personId)
                ),
                inputs
            )
        }))
    );

const rosterChange = (context: ChangeContext) => ({
    communityId: context.user.communityId,
    sessionId: context.tap.sessionId,
    actorPersonId: context.actorPersonId
});

const rosterTransform = Effect.fn('Bot.teamsRosterChange')(function* (context: ChangeContext, state: DraftState) {
    const { tap } = context;
    const players = playersOf(state);
    const first = players[Number(tap.args[0])] ?? '';

    switch (tap.op) {
        case 'P': {
            const host = tap.args[0] === 'n' ? null : (players[Number(tap.args[0])] ?? null);
            const added = yield* addGuests(rosterChange(context), { hostPersonId: host, count: Number(tap.args[1]), name: null });
            const seated = added.filter(guest => guest.status === 'in').map(guest => guest.personId);

            return yield* afterRoster(context, state, synced =>
                isNotEmptyArray(seated) ? movePlayers(synced, seated, Number(tap.args[2])) : synced
            );
        }
        case 'R':
        case 'o': {
            const team = teamIndexOf(state, first);
            const removed = yield* removeFromGame(rosterChange(context), {
                personId: first,
                withGuests: tap.args[1] === '1',
                isNoShow: tap.op === 'o'
            });
            const promoted = removed.promoted.map(entry => entry.personId);

            return yield* afterRoster(context, state, (synced, inputs) =>
                isNotEmptyArray(promoted) && team >= 0 ? movePlayers(synced, promoted, team) : rebalanced(inputs, synced)
            );
        }
        case 'J': {
            const personId = fromShortId(tap.args[0] ?? '');
            yield* joinGame(rosterChange(context), isDefined(personId) ? [personId] : [], tap.args[1] === '1');

            return yield* afterRoster(context, state, (synced, inputs) => rebalanced(inputs, synced));
        }
        default: {
            return state;
        }
    }
});

const transformOf = (context: ChangeContext, state: DraftState) => {
    const { tap, inputs } = context;
    const players = playersOf(state);
    const at = (position: number) => players[Number(tap.args[position])];
    const first = at(0) ?? '';
    const second = at(1) ?? '';
    const number = (position: number) => Number(tap.args[position]);
    const roster = inputs.members.map(member => member.personId);

    switch (tap.op) {
        case 'w': {
            return Effect.succeed(isDefined(at(0)) && isDefined(at(1)) ? swapOrPlace(state, first, second) : state);
        }
        case 'm': {
            const guests = tap.args[2] === '1' ? guestsWith(state, inputs, first) : [];

            return Effect.succeed(isDefined(at(0)) ? movePlayers(state, [first, ...guests], number(1)) : state);
        }
        case 'l': {
            return Effect.succeed(isDefined(at(0)) ? toggleLock(state, first) : state);
        }
        case 'k': {
            return Effect.succeed(isDefined(at(0)) ? toggleKeeper(state, first) : state);
        }
        case 'u': {
            return Effect.succeed(syncByAdmin(undo(state), roster));
        }
        case 'h': {
            return Effect.succeed(shuffled(inputs, state));
        }
        case 'v': {
            return Effect.succeed(syncByAdmin(pickVariant(state, number(0)), roster));
        }
        case 'b':
        case 'A': {
            return Effect.succeed(rebalanced(inputs, state));
        }
        case 'f': {
            return Effect.succeed(freshState(inputs, state.teams.length, state));
        }
        case 'n': {
            return Effect.succeed(freshState(inputs, Math.max(2, Math.min(6, number(0))), state));
        }
        case 'C': {
            const badge = badges[number(1)];

            return Effect.succeed(isDefined(badge) ? setColour(state, number(0), badge.colour) : state);
        }
        default: {
            return rosterTransform(context, state);
        }
    }
};

export const applyChange = (context: ChangeContext) =>
    changeDraft(
        {
            sessionId: context.tap.sessionId,
            version: context.tap.version,
            key: `${context.user.tgUserId}:${context.tap.op}:${context.tap.args.join(':')}`,
            actorPersonId: context.actorPersonId
        },
        state => transformOf(context, state)
    );
