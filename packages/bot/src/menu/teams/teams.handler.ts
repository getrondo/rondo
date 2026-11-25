import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { requireSession } from '@rondo/core/sessions/session.service';
import { joinCandidates, waitingOf } from '@rondo/core/signups/roster.service';
import { playersOf } from '@rondo/core/teams/draft-state';
import { personNames } from '@rondo/core/teams/team-inputs';
import { recordResult, squadChanged } from '@rondo/core/teams/team-result';
import { setTier } from '@rondo/core/teams/team.service';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { fromShortId } from '../../utils/from-short-id.util';
import { gameCardPage } from '../games.screen';
import { menuText } from '../menu-text';
import { showScreen } from '../show-screen';

import { parseTeamsData, type TeamsTap } from './teams-callback';
import { applyChange, hostGuestsInTeam } from './teams-changes';
import { editorScreen } from './teams-editor.screen';
import { handlePasteTap } from './teams-input';
import { notifyRosterChange } from './teams-notify';
import { overviewScreen, publishAndShow } from './teams-publish';
import {
    colourScreen,
    fullAsk,
    guestCountScreen,
    joinersScreen,
    moveScreen,
    namePrompt,
    removeScreen,
    settingsScreen
} from './teams-screens';
import { teamsText } from './teams-text';
import { actorOf, loadView, showTeams } from './teams-view';

import type { MenuUser } from '../screen.interface';
import type { EditorView } from './teams-view.interface';
import type { Tier } from '@rondo/core/teams/interface/team-inputs.interface';

const changingOps = new Set(['w', 'm', 'l', 'k', 'u', 'h', 'V', 'b', 'A', 'f', 'n', 'C', 'P', 'R', 'o', 'J']);
const overviewOps = new Set(['A', 'V']);
const nextTier: Readonly<Record<Tier | 'none', Tier>> = { none: 'normal', normal: 'strong', strong: 'new', new: 'normal' };

const viewScreen = Effect.fn('Bot.teamsViewScreen')(function* (user: MenuUser, view: EditorView, tap: TeamsTap) {
    const selected = playersOf(view.row.state)[Number(tap.args[0])] ?? null;

    switch (tap.op) {
        case 's': {
            return editorScreen(user, { ...view, selected });
        }
        case 'c': {
            return colourScreen(user, view, Math.min(Number(tap.args[0]), view.row.state.teams.length - 1));
        }
        case 'g': {
            return namePrompt(user, view);
        }
        case 'G': {
            return guestCountScreen(user, view, tap.args[0] ?? '');
        }
        case 'L': {
            return settingsScreen(user, view);
        }
        case 'j': {
            const candidates = yield* joinCandidates(user.communityId, view.row.sessionId, 12);

            return joinersScreen(user, view, candidates);
        }
        case 'r': {
            return removeScreen(user, view, {
                personId: selected ?? '',
                guests: view.inputs.members.filter(member => member.isGuest && member.hostId === selected).length,
                waiting: view.waiting[0] ?? null,
                hasStarted: user.now.getTime() >= view.inputs.game.startsAt.getTime()
            });
        }
        case 'O': {
            return yield* overviewScreen(user, view);
        }
        default: {
            return editorScreen(user, view);
        }
    }
});

const isDirectRemoval = (user: MenuUser, view: EditorView, tap: TeamsTap): boolean => {
    const selected = playersOf(view.row.state)[Number(tap.args[0])];

    return (
        tap.op === 'r' &&
        tap.version === view.row.version &&
        !view.inputs.members.some(member => member.isGuest && member.hostId === selected) &&
        !isNotEmptyArray(view.waiting) &&
        user.now.getTime() < view.inputs.game.startsAt.getTime()
    );
};

const fullScreen = Effect.fn('Bot.teamsFull')(function* (user: MenuUser, tap: TeamsTap) {
    const view = yield* loadView(user, tap.sessionId, { page: tap.page });
    const { taken } = yield* waitingOf(tap.sessionId);
    const limit = view.inputs.game.capacityMax;
    const isGuests = tap.op === 'P';
    const coming = isGuests ? Number(tap.args[1]) : 1;

    if (!isDefined(limit) || taken + coming <= limit || tap.version !== view.row.version) {
        return null;
    }

    const personId = isGuests ? (playersOf(view.row.state)[Number(tap.args[0])] ?? '') : (fromShortId(tap.args[0] ?? '') ?? '');
    const names = yield* personNames([personId]);
    const name = names.get(personId) ?? '?';

    return fullAsk(user, view, {
        who: isGuests ? teamsText(user.locale, 'guestsOf', { count: coming, name }) : name,
        taken,
        limit,
        op: tap.op,
        args: tap.args
    });
});

const changedScreen = (user: MenuUser, tap: TeamsTap, view: EditorView) =>
    overviewOps.has(tap.op) ? overviewScreen(user, view) : Effect.succeed(editorScreen(user, view));

const changeScreen = Effect.fn('Bot.teamsChange')(function* (user: MenuUser, tap: TeamsTap) {
    const view = yield* loadView(user, tap.sessionId, { page: tap.page });
    const mover = playersOf(view.row.state)[Number(tap.args[0])];
    const guests = isDefined(mover) ? hostGuestsInTeam(view.row.state, view.inputs, mover).length : 0;

    if (tap.op === 'm' && guests > 0 && !isDefined(tap.args[2]) && tap.version === view.row.version) {
        return { screen: moveScreen(user, view, { personId: mover ?? '', team: Number(tap.args[1]), guests }), toast: null };
    }

    const change = yield* applyChange({ user, tap, inputs: view.inputs, actorPersonId: yield* actorOf(user) });
    const notes = change._tag === 'stale' ? [teamsText(user.locale, 'changedByOther')] : [];
    const fresh = yield* loadView(user, tap.sessionId, { page: tap.page, notes, row: change.row });

    return {
        screen: tap.op === 'C' ? settingsScreen(user, fresh) : yield* changedScreen(user, tap, fresh),
        toast: change._tag === 'stale' ? teamsText(user.locale, 'changedByOther') : null
    };
});

const resultTap = Effect.fn('Bot.teamsResult')(function* (user: MenuUser, tap: TeamsTap, messageId: number) {
    const isChoosing = tap.args[0] === 'c';
    const winner = Number(tap.args[0]);
    const recorded = isChoosing
        ? true
        : yield* recordResult({
              communityId: user.communityId,
              sessionId: tap.sessionId,
              winner: winner > 0 ? winner : null,
              actorPersonId: yield* actorOf(user),
              now: user.now,
              squad: tap.args[1] ?? null
          }).pipe(
              Effect.as(true),
              Effect.catchTag('ActionFailedError', failure =>
                  failure.reason === squadChanged ? Effect.succeed(false) : Effect.fail(failure)
              )
          );
    const card = yield* gameCardPage(user, tap.sessionId, null, { page: 0, isChoosing });
    yield* showScreen(user.chatId, messageId, card);

    return recorded ? Option.none<string>() : Option.some(teamsText(user.locale, 'squadChanged'));
});

const tierTap = Effect.fn('Bot.teamsTier')(function* (user: MenuUser, view: EditorView, tap: TeamsTap) {
    const personId = playersOf(view.row.state)[Number(tap.args[0])];
    const member = view.inputs.members.find(entry => entry.personId === personId);

    if (isDefined(member) && !member.isGuest) {
        yield* setTier({
            communityId: user.communityId,
            personId: member.personId,
            tier: nextTier[member.tier ?? 'none'],
            actorPersonId: yield* actorOf(user)
        });
    }

    const fresh = yield* loadView(user, tap.sessionId, { page: tap.page });

    return settingsScreen(user, fresh);
});

const routedTap = Effect.fn('Bot.teamsRoutedTap')(function* (user: MenuUser, tap: TeamsTap, messageId: number) {
    if (tap.op === 'W') {
        return yield* resultTap(user, tap, messageId);
    }

    if (tap.op === 'Q' || tap.op === 'U') {
        yield* handlePasteTap(user, tap, messageId);

        return Option.none<string>();
    }

    if (tap.op === 'X') {
        yield* publishAndShow(user, tap, messageId);

        return Option.none<string>();
    }

    const asked =
        (tap.op === 'J' && tap.args.length === 1) || (tap.op === 'P' && tap.args.length === 2) ? yield* fullScreen(user, tap) : null;

    if (isDefined(asked)) {
        yield* showTeams(user, messageId, { sessionId: tap.sessionId, screen: asked });

        return Option.none<string>();
    }

    return null;
});

const teamsTap = Effect.fn('Bot.teamsTap')(function* (user: MenuUser, data: string, messageId: number) {
    const tap = parseTeamsData(data);
    const game = isDefined(tap) ? yield* requireSession(user.communityId, tap.sessionId).pipe(Effect.option) : Option.none();

    if (!isDefined(tap) || Option.isNone(game)) {
        return Option.some(menuText(user.locale, isDefined(tap) ? 'unknownGame' : 'stale'));
    }

    const routed = yield* routedTap(user, tap, messageId);

    if (isDefined(routed)) {
        return routed;
    }

    const view = yield* loadView(user, tap.sessionId, { page: tap.page, offerLevels: tap.op === 'O', place: tap.op === 'O' });
    const direct = isDirectRemoval(user, view, tap) ? { ...tap, op: 'R', args: [tap.args[0] ?? '', '0'] } : tap;

    if (changingOps.has(direct.op)) {
        const changed = yield* changeScreen(user, direct);
        yield* showTeams(user, messageId, { sessionId: tap.sessionId, screen: changed.screen });

        return Option.fromNullishOr(changed.toast);
    }

    const isStale = tap.version !== view.row.version && tap.op !== 'e' && tap.op !== 'O';
    const isGuestStep = (tap.op === 'G' || tap.op === 'g') && !isStale;
    const shown = isStale ? { ...view, notes: [teamsText(user.locale, 'changedByOther')] } : view;
    const screen =
        tap.op === 'Y' && !isStale ? yield* tierTap(user, view, tap) : yield* viewScreen(user, shown, isStale ? { ...tap, op: 'e' } : tap);
    yield* showTeams(user, messageId, {
        sessionId: tap.sessionId,
        screen,
        draft: isGuestStep
            ? { step: 'guest', host: tap.op === 'G' ? (playersOf(view.row.state)[Number(tap.args[0])] ?? 'n') : 'n' }
            : { step: 'editor', host: null }
    });

    return isStale ? Option.some(teamsText(user.locale, 'changedByOther')) : Option.none<string>();
});

export const handleTeamsTap = Effect.fn('Bot.handleTeamsTap')(function* (user: MenuUser, data: string, messageId: number) {
    const toast = yield* teamsTap(user, data, messageId);
    const tap = parseTeamsData(data);

    if (isDefined(tap)) {
        yield* notifyRosterChange(tap.sessionId, user.now).pipe(
            Effect.catchCause(cause => Effect.logWarning('[teams] late change not delivered', cause))
        );
    }

    return toast;
});
