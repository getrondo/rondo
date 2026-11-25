import { isDefined } from '@rnw-community/shared';
import { requireSession } from '@rondo/core/sessions/session.service';
import { joinCandidates, waitingOf } from '@rondo/core/signups/roster.service';
import { playersOf } from '@rondo/core/teams/draft-state';
import { personNames } from '@rondo/core/teams/team-inputs';
import { recordResult } from '@rondo/core/teams/team-result';
import { setTier } from '@rondo/core/teams/team.service';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { fromShortId } from '../../utils/from-short-id.util';
import { gameCardScreen } from '../games.screen';
import { menuText } from '../menu-text';
import { showScreen } from '../show-screen';

import { parseTeamsData, type TeamsTap } from './teams-callback';
import { applyChange, hostGuestsInTeam } from './teams-changes';
import { editorScreen } from './teams-editor.screen';
import { handlePasteTap } from './teams-input';
import { notifyRosterChange } from './teams-notify';
import { previewScreen, publishAndShow, retryPreview } from './teams-publish';
import {
    colourScreen,
    overLimitAsk,
    guestCountScreen,
    guestHostScreen,
    guestPlaceScreen,
    joinersScreen,
    moveScreen,
    removeScreen,
    tiersScreen
} from './teams-screens';
import { teamsText } from './teams-text';
import { actorOf, loadView, showTeams } from './teams-view';

import type { MenuUser } from '../screen.interface';
import type { EditorView } from './teams-view.interface';
import type { Tier } from '@rondo/core/teams/interface/team-inputs.interface';

const changingOps = new Set(['w', 'm', 'l', 'k', 'u', 'h', 'v', 'b', 'A', 'f', 'n', 'C', 'P', 'R', 'o', 'J']);
const nextTier: Readonly<Record<Tier | 'none', Tier>> = { none: 'normal', normal: 'strong', strong: 'new', new: 'normal' };

const weakestTeam = (view: EditorView): number => {
    const sizes = view.row.state.teams.map(members => members.length);

    return sizes.indexOf(Math.min(...sizes));
};

const viewScreen = Effect.fn('Bot.teamsViewScreen')(function* (user: MenuUser, view: EditorView, tap: TeamsTap) {
    const players = playersOf(view.row.state);
    const at = (position: number) => players[Number(tap.args[position])];
    const selected = at(0) ?? null;

    switch (tap.op) {
        case 's': {
            return editorScreen(user, { ...view, selected });
        }
        case 'T': {
            return editorScreen(user, { ...view, title: Number(tap.args[0]) });
        }
        case 'c': {
            return colourScreen(user, view, Math.min(Number(tap.args[0]), view.row.state.teams.length - 1));
        }
        case 'g': {
            return guestHostScreen(user, view);
        }
        case 'G': {
            return guestCountScreen(user, view, tap.args[0] ?? 'n');
        }
        case 'N': {
            return guestPlaceScreen(user, view, { host: tap.args[0] ?? 'n', count: Number(tap.args[1]), weakest: weakestTeam(view) });
        }
        case 'L': {
            return tiersScreen(user, view);
        }
        case 'j': {
            const candidates = yield* joinCandidates(user.communityId, view.row.sessionId, 12);

            return joinersScreen(user, view, candidates);
        }
        case 'x': {
            return previewScreen(user, view);
        }
        case 'Z': {
            return yield* retryPreview(user, view, tap.args[0] ?? '');
        }
        case 'r': {
            const { waiting } = yield* waitingOf(view.row.sessionId);
            const personId = selected ?? '';

            return removeScreen(user, view, {
                personId,
                guests: view.inputs.members.filter(member => member.isGuest && member.hostId === personId).length,
                waiting: waiting[0]?.displayName ?? null
            });
        }
        default: {
            return editorScreen(user, view);
        }
    }
});

const overLimitScreen = Effect.fn('Bot.teamsOverLimit')(function* (user: MenuUser, tap: TeamsTap) {
    const view = yield* loadView(user, tap.sessionId, { page: tap.page });
    const { waiting, taken } = yield* waitingOf(tap.sessionId);
    const limit = view.inputs.game.capacityMax;
    const personId = fromShortId(tap.args[0] ?? '') ?? '';
    const names = yield* personNames([personId]);
    const joiner = names.get(personId) ?? '?';

    return isDefined(limit) && taken >= limit && tap.version === view.row.version
        ? overLimitAsk(user, view, { joiner, taken, limit, waiting: waiting.map(entry => entry.displayName), arg: tap.args[0] ?? '' })
        : null;
});

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
    const isPublishing = tap.op === 'A' && change._tag === 'changed' && isDefined(change.row.publishedAt);

    return {
        screen: isPublishing ? previewScreen(user, fresh) : editorScreen(user, fresh),
        toast: change._tag === 'stale' ? teamsText(user.locale, 'changedByOther') : null
    };
});

const resultTap = Effect.fn('Bot.teamsResult')(function* (user: MenuUser, tap: TeamsTap, messageId: number) {
    const winner = Number(tap.args[0]);
    const saved = yield* recordResult({
        communityId: user.communityId,
        sessionId: tap.sessionId,
        winner: winner > 0 ? winner : null,
        actorPersonId: yield* actorOf(user),
        now: user.now
    }).pipe(Effect.option);
    const recorded = Option.getOrNull(saved);
    const savedKey = recorded?.isCorrection === true ? 'resultChanged' : 'resultSaved';
    const header = teamsText(user.locale, isDefined(recorded) ? savedKey : 'resultTwice');
    const card = yield* gameCardScreen(user, tap.sessionId, { text: header, saysPoll: false });
    yield* showScreen(user.chatId, messageId, card);

    return Option.none<string>();
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

    return tiersScreen(user, fresh);
});

const teamsTap = Effect.fn('Bot.teamsTap')(function* (user: MenuUser, data: string, messageId: number) {
    const tap = parseTeamsData(data);
    const game = isDefined(tap) ? yield* requireSession(user.communityId, tap.sessionId).pipe(Effect.option) : Option.none();

    if (!isDefined(tap) || Option.isNone(game)) {
        return Option.some(menuText(user.locale, isDefined(tap) ? 'unknownGame' : 'stale'));
    }

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

    if (tap.op === 'J' && tap.args.length === 1) {
        const asked = yield* overLimitScreen(user, tap);

        if (isDefined(asked)) {
            yield* showTeams(user, messageId, { sessionId: tap.sessionId, screen: asked });

            return Option.none<string>();
        }
    }

    if (changingOps.has(tap.op)) {
        const changed = yield* changeScreen(user, tap);
        yield* showTeams(user, messageId, { sessionId: tap.sessionId, screen: changed.screen });

        return Option.fromNullishOr(changed.toast);
    }

    const view = yield* loadView(user, tap.sessionId, { page: tap.page, offerLevels: tap.op === 'e' });
    const isStale = tap.version !== view.row.version && tap.op !== 'e';
    const isGuestStep = tap.op === 'G' && !isStale;
    const shown = isStale ? { ...view, notes: [teamsText(user.locale, 'changedByOther')] } : view;
    const screen =
        tap.op === 'Y' && !isStale ? yield* tierTap(user, view, tap) : yield* viewScreen(user, shown, isStale ? { ...tap, op: 'e' } : tap);
    yield* showTeams(user, messageId, {
        sessionId: tap.sessionId,
        screen,
        draft: isGuestStep ? { step: 'guest', host: playersOf(view.row.state)[Number(tap.args[0])] ?? 'n' } : { step: 'editor', host: null }
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
