import { isDefined } from '@rnw-community/shared';
import { ActionSchema, type Action } from '@rondo/core/actions/action.model';
import { consumeAdminState, loadAdminState, moveAdminMessage, saveAdminState, takeAwaiting } from '@rondo/core/menu/admin-state.repository';
import { requireSession } from '@rondo/core/sessions/session.service';
import { proposeTeams } from '@rondo/core/teams/team.service';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { fromShortId } from '../../utils/from-short-id.util';
import { parseTime } from '../../utils/parse-time.util';
import { gameCardScreen, gamesScreen } from '../games.screen';
import { menuText } from '../menu-text';
import { loadNewGameData } from '../new-game/new-game.data';
import { runConfirmed } from '../run-confirmed';
import { clearKeyboard, showScreen } from '../show-screen';
import { replyStale } from '../stale-reply';

import { confirmScreen, gameListScreen } from './game-actions.screens';
import { GameDraftSchema, sessionOf, type GameDraft } from './game-draft';
import { targetOfAction } from './game-target';

import type { MenuUser } from '../screen.interface';
import type { AdminStateRow } from '@rondo/core/menu/admin-state.interface';

const decodeGameDraft = Schema.decodeUnknownOption(GameDraftSchema);
const decodeAction = Schema.decodeUnknownOption(ActionSchema);
const encodeAction = Schema.encodeEffect(ActionSchema);
const reasonLiterals = new Set(['weather', 'low_turnout', 'venue', 'holiday', 'organizer', 'other']);
const listOps = new Set(['t', 'dd', 'v', 'z', 'x', 'k']);

const showConfirm = Effect.fn('Bot.showGameConfirm')(function* (user: MenuUser, action: Action, messageId: number | null) {
    const encoded = yield* encodeAction(action).pipe(Effect.orDie);
    const draft: GameDraft = { flow: 'game', view: 'confirm', sessionId: sessionOf(action), action: encoded, summary: null };
    const saved = yield* saveAdminState({
        tgUserId: user.tgUserId,
        communityId: user.communityId,
        messageId,
        awaiting: null,
        draft,
        now: user.now
    });
    const screen = yield* confirmScreen(user, action, saved.revision);
    const shownId = yield* showScreen(user.chatId, messageId, screen);

    if (shownId !== messageId) {
        yield* moveAdminMessage(user.tgUserId, shownId);
    }
});

const compact = (value: string): string => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

const changeOf = (user: MenuUser, sessionId: string, tap: { readonly op: string; readonly arg: string }): Action | null => {
    const self = String(user.tgUserId);
    const venueId = tap.op === 'vs' ? fromShortId(tap.arg) : null;
    const changes: Readonly<Record<string, () => Action | null>> = {
        p: () => ({ _tag: 'announce_session', sessionId }),
        pm: () => ({ _tag: 'announce_session', sessionId, chatId: self }),
        pr: () => ({ _tag: 'forward_poll', sessionId, chatId: self }),
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

const teamsOf = Effect.fn('Bot.teamsOf')(function* (sessionId: string, count: number) {
    const teams = yield* proposeTeams(sessionId, count);
    const players = teams.reduce((total, team) => total + team.players.length, 0);

    return players >= count * 2 ? Option.some<Action>({ _tag: 'publish_teams', sessionId, teams }) : Option.none<Action>();
});

const isToMe = (user: MenuUser, action: Action): boolean =>
    (action._tag === 'announce_session' || action._tag === 'forward_poll') && action.chatId === String(user.tgUserId);

const afterDone = Effect.fn('Bot.afterGameDone')(function* (user: MenuUser, action: Action, messageId: number, where: string) {
    const sessionId = sessionOf(action);

    if (action._tag === 'delete_session') {
        const games = yield* gamesScreen(user);
        yield* showScreen(user.chatId, messageId, { ...games, text: `${menuText(user.locale, 'deleted')}\n\n${games.text}` });

        return;
    }

    if (isToMe(user, action)) {
        const header = [menuText(user.locale, 'announcedMe'), menuText(user.locale, 'selfHint')].join('\n');
        yield* clearKeyboard(user.chatId, messageId);
        const card = yield* gameCardScreen(user, sessionId, header);
        yield* showScreen(user.chatId, null, card);

        return;
    }

    const header =
        action._tag === 'forward_poll' || action._tag === 'announce_session'
            ? menuText(user.locale, action._tag === 'forward_poll' ? 'forwardedTo' : 'announced', { where: escapeHtml(where) })
            : menuText(user.locale, 'changedDone');
    const card = yield* gameCardScreen(user, sessionId, header);
    yield* showScreen(user.chatId, messageId, card);
});

const confirmTap = Effect.fn('Bot.confirmGameTap')(function* (user: MenuUser, revision: string, notify: boolean, messageId: number) {
    const state = yield* loadAdminState(user.tgUserId, user.now);
    const draft = state.pipe(Option.flatMap(row => decodeGameDraft(row.draft)));
    const action = draft.pipe(Option.flatMap(value => decodeAction(value.action)));

    if (Option.isNone(state) || Option.isNone(action) || String(state.value.revision) !== revision || state.value.messageId !== messageId) {
        return yield* replyStale(user, messageId, true);
    }

    const consumed = yield* consumeAdminState(user.tgUserId, state.value.revision, user.now);

    if (Option.isNone(consumed)) {
        return yield* replyStale(user, messageId, true);
    }

    const chosen = 'notify' in action.value ? { ...action.value, notify } : action.value;
    const target = yield* targetOfAction(user, chosen, sessionOf(chosen));
    const outcome = yield* runConfirmed(user, chosen, { summary: null, target: { where: target.where, isPrivate: target.me } });

    if (outcome._tag === 'done') {
        yield* afterDone(user, chosen, messageId, target.where);

        return Option.none<string>();
    }

    const card = yield* gameCardScreen(user, sessionOf(chosen), outcome.text);
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

    if (listOps.has(op)) {
        const data = yield* loadNewGameData(user);
        const view = op === 't' ? 'time' : 'size';
        const draft: GameDraft = { flow: 'game', view, sessionId: game.value.id, action: null, summary: null };
        const awaiting = op === 't' || op === 'z' ? view : null;
        yield* saveAdminState({ tgUserId: user.tgUserId, communityId: user.communityId, messageId, awaiting, draft, now: user.now });
        yield* showScreen(user.chatId, messageId, gameListScreen(user, game.value, data, op));

        return Option.none<string>();
    }

    const teams = op === 'kn' ? yield* teamsOf(game.value.id, Number(arg)) : Option.none<Action>();
    const action = Option.getOrNull(teams) ?? changeOf(user, game.value.id, { op, arg });

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
