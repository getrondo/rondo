import { isDefined } from '@rnw-community/shared';
import { ActionSchema, type Action } from '@rondo/core/actions/action.model';
import { consumeAdminState, loadAdminState, moveAdminMessage, saveAdminState, takeAwaiting } from '@rondo/core/menu/admin-state.repository';
import { requireSession } from '@rondo/core/sessions/session.service';
import { proposeTeams } from '@rondo/core/teams/team.service';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { fromShortId } from '../../utils/from-short-id.util';
import { parseTime } from '../../utils/parse-time.util';
import { gameCardScreen } from '../games.screen';
import { menuText } from '../menu-text';
import { loadNewGameData } from '../new-game/new-game.data';
import { runConfirmed } from '../run-confirmed';
import { showScreen } from '../show-screen';

import { confirmScreen, gameListScreen } from './game-actions.screens';
import { GameDraftSchema, sessionOf, type GameDraft } from './game-draft';

import type { MenuUser } from '../screen.interface';
import type { AdminStateRow } from '@rondo/core/menu/admin-state.interface';

const decodeGameDraft = Schema.decodeUnknownOption(GameDraftSchema);
const decodeAction = Schema.decodeUnknownOption(ActionSchema);
const encodeAction = Schema.encodeEffect(ActionSchema);
const reasonLiterals = new Set(['weather', 'low_turnout', 'venue', 'holiday', 'organizer', 'other']);

const showConfirm = Effect.fn('Bot.showGameConfirm')(function* (user: MenuUser, action: Action, messageId: number | null) {
    const data = yield* loadNewGameData(user);
    const encoded = yield* encodeAction(action).pipe(Effect.orDie);
    const sessionId = sessionOf(action);
    const draft: GameDraft = { flow: 'game', view: 'confirm', sessionId, action: encoded, summary: null };
    const saved = yield* saveAdminState({
        tgUserId: user.tgUserId,
        communityId: user.communityId,
        messageId,
        awaiting: null,
        draft,
        now: user.now
    });
    const screen = yield* confirmScreen(user, action, { revision: saved.revision, hasGroup: data.hasGroup });
    const shownId = yield* showScreen(user.chatId, messageId, screen);

    if (shownId !== messageId) {
        yield* moveAdminMessage(user.tgUserId, shownId);
    }
});

const changeOf = (sessionId: string, op: string, arg: string): Action | null => {
    switch (op) {
        case 'p': {
            return { _tag: 'announce_session', sessionId };
        }
        case 'ts': {
            return { _tag: 'update_session', sessionId, localTime: `${arg.slice(0, 2)}:${arg.slice(2, 4)}`, notify: true };
        }
        case 'vs': {
            const venueId = fromShortId(arg);

            return isDefined(venueId) ? { _tag: 'update_session', sessionId, venueId, notify: true } : null;
        }
        case 'zs': {
            return { _tag: 'update_session', sessionId, capacityMax: arg === '0' ? null : Number(arg), notify: true };
        }
        default: {
            return null;
        }
    }
};

const cancelOf = (sessionId: string, arg: string): Action | null =>
    reasonLiterals.has(arg)
        ? (Option.getOrNull(decodeAction({ _tag: 'cancel_session', sessionId, reason: arg, notify: true })) ?? null)
        : null;

const teamsOf = Effect.fn('Bot.teamsOf')(function* (sessionId: string, count: number) {
    const teams = yield* proposeTeams(sessionId, count);
    const players = teams.reduce((total, team) => total + team.players.length, 0);

    return players >= count * 2 ? Option.some<Action>({ _tag: 'publish_teams', sessionId, teams }) : Option.none<Action>();
});

const confirmTap = Effect.fn('Bot.confirmGameTap')(function* (user: MenuUser, revision: string, notify: boolean, messageId: number) {
    const state = yield* loadAdminState(user.tgUserId, user.now);
    const draft = state.pipe(Option.flatMap(row => decodeGameDraft(row.draft)));
    const action = draft.pipe(Option.flatMap(value => decodeAction(value.action)));

    if (Option.isNone(state) || Option.isNone(action) || String(state.value.revision) !== revision || state.value.messageId !== messageId) {
        return Option.some(menuText(user.locale, 'stale'));
    }

    const consumed = yield* consumeAdminState(user.tgUserId, state.value.revision, user.now);

    if (Option.isNone(consumed)) {
        return Option.some(menuText(user.locale, 'stale'));
    }

    const chosen = 'notify' in action.value ? { ...action.value, notify } : action.value;
    const outcome = yield* runConfirmed(user, chosen, null);
    const sessionId = sessionOf(chosen);
    const header = outcome._tag === 'done' ? menuText(user.locale, 'changedDone') : outcome.text;
    const card = yield* gameCardScreen(user, sessionId, header);
    yield* showScreen(user.chatId, messageId, card);

    return Option.none<string>();
});

export const handleGameTap = Effect.fn('Bot.handleGameTap')(function* (user: MenuUser, parts: readonly string[], messageId: number) {
    const [, op = '', id = '', arg = ''] = parts;

    if (op === 'ok') {
        return yield* confirmTap(user, id, arg === '1', messageId);
    }

    const sessionId = fromShortId(id);
    const game = isDefined(sessionId) ? yield* requireSession(user.communityId, sessionId).pipe(Effect.option) : Option.none();

    if (Option.isNone(game)) {
        return Option.some(menuText(user.locale, 'unknownGame'));
    }

    if (['t', 'v', 'z', 'x', 'k'].includes(op)) {
        const data = yield* loadNewGameData(user);
        const view = op === 't' ? 'time' : 'size';
        const draft: GameDraft = { flow: 'game', view, sessionId: game.value.id, action: null, summary: null };
        const awaiting = op === 't' || op === 'z' ? view : null;
        yield* saveAdminState({ tgUserId: user.tgUserId, communityId: user.communityId, messageId, awaiting, draft, now: user.now });
        yield* showScreen(user.chatId, messageId, gameListScreen(user, game.value, data, op));

        return Option.none<string>();
    }

    const teams = op === 'kn' ? yield* teamsOf(game.value.id, Number(arg)) : Option.none<Action>();
    const action = op === 'xr' ? cancelOf(game.value.id, arg) : (Option.getOrNull(teams) ?? changeOf(game.value.id, op, arg));

    if (!isDefined(action)) {
        return Option.some(menuText(user.locale, op === 'kn' ? 'noTeams' : 'stale'));
    }

    yield* showConfirm(user, action, messageId);

    return Option.none<string>();
});

const typedChange = (draft: GameDraft, text: string): Action | null => {
    const time = parseTime(text);
    const places = /^\d{1,2}$/u.test(text.trim()) ? Number(text.trim()) : 0;

    if (draft.view === 'time' && time._tag === 'time') {
        return { _tag: 'update_session', sessionId: draft.sessionId, localTime: time.value, notify: true };
    }

    return draft.view === 'size' && places >= 1
        ? { _tag: 'update_session', sessionId: draft.sessionId, capacityMax: places, notify: true }
        : null;
};

export const handleGameInput = Effect.fn('Bot.handleGameInput')(function* (user: MenuUser, row: AdminStateRow, text: string) {
    const draft = decodeGameDraft(row.draft);

    if (Option.isNone(draft)) {
        return false;
    }

    const action = typedChange(draft.value, text);

    if (!isDefined(action)) {
        return false;
    }

    const taken = yield* takeAwaiting(user.tgUserId, row.revision, user.now);

    if (Option.isNone(taken)) {
        return false;
    }

    yield* showConfirm(user, action, null);

    return true;
});
