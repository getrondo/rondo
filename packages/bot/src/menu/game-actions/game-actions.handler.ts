import { isDefined } from '@rnw-community/shared';
import { ActionSchema, type Action } from '@rondo/core/actions/action.model';
import { consumeAdminState, loadAdminState } from '@rondo/core/menu/admin-state.repository';
import { requireSession } from '@rondo/core/sessions/session.service';
import { proposeTeams } from '@rondo/core/teams/team.service';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { fromShortId } from '../../utils/from-short-id.util';
import { gameCardScreen, gamesScreen } from '../games.screen';
import { menuText } from '../menu-text';
import { loadNewGameData } from '../new-game/new-game.data';
import { showSelfReceipt } from '../new-game/self-receipt';
import { runConfirmed } from '../run-confirmed';
import { showScreen } from '../show-screen';
import { rememberDone, replyStale } from '../stale-reply';

import { GameDraftSchema, listViews, sessionOf } from './game-draft';
import { targetOfAction } from './game-target';
import { showConfirm, showGameList } from './show-confirm';

import type { MenuUser } from '../screen.interface';
import type { SessionView } from '@rondo/core/sessions/session.model';

const decodeGameDraft = Schema.decodeUnknownOption(GameDraftSchema);
const decodeAction = Schema.decodeUnknownOption(ActionSchema);
const reasonLiterals = new Set(['weather', 'low_turnout', 'venue', 'holiday', 'organizer', 'other']);

const compact = (value: string): string => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

const changeOf = (user: MenuUser, sessionId: string, tap: { readonly op: string; readonly arg: string }): Action | null => {
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
        yield* showSelfReceipt(user, messageId, { sessionId, status: 'sentMe' });

        return;
    }

    const isPost = action._tag === 'forward_poll' || action._tag === 'announce_session';
    const header = isPost
        ? menuText(user.locale, action._tag === 'forward_poll' ? 'forwardedTo' : 'announced', { where: escapeHtml(where) })
        : menuText(user.locale, 'changedDone');
    const card = yield* gameCardScreen(user, sessionId, { text: header, saysPoll: isPost });
    yield* showScreen(user.chatId, messageId, card);
});

const runGameAction = Effect.fn('Bot.runGameAction')(function* (
    user: MenuUser,
    action: Action,
    tap: { readonly messageId: number; readonly revision: string }
) {
    const target = yield* targetOfAction(user, action, sessionOf(action));
    const outcome = yield* runConfirmed(user, action, { summary: null, target: { where: target.where, isPrivate: target.me } });

    if (outcome._tag === 'done') {
        yield* afterDone(user, action, tap.messageId, target.where);
        yield* rememberDone(user, tap.messageId, {
            sessionId: sessionOf(action),
            created: false,
            self: isToMe(user, action),
            revision: tap.revision
        });

        return Option.none<string>();
    }

    const card = yield* gameCardScreen(user, sessionOf(action), { text: outcome.text, saysPoll: false });
    yield* showScreen(user.chatId, tap.messageId, card);

    return Option.none<string>();
});

const confirmTap = Effect.fn('Bot.confirmGameTap')(function* (user: MenuUser, revision: string, notify: boolean, messageId: number) {
    const state = yield* loadAdminState(user.tgUserId, user.now);
    const draft = state.pipe(
        Option.filter(row => row.messageId === messageId),
        Option.flatMap(row => decodeGameDraft(row.draft))
    );
    const action = draft.pipe(Option.flatMap(value => decodeAction(value.action)));

    if (Option.isNone(state) || Option.isNone(action)) {
        return yield* replyStale(user, messageId, revision);
    }

    if (String(state.value.revision) !== revision) {
        yield* showConfirm(user, action.value, messageId);

        return Option.none<string>();
    }

    const consumed = yield* consumeAdminState(user.tgUserId, state.value.revision, user.now);

    if (Option.isNone(consumed)) {
        return yield* replyStale(user, messageId, revision);
    }

    const chosen = 'notify' in action.value ? { ...action.value, notify } : action.value;

    return yield* runGameAction(user, chosen, { messageId, revision });
});

const listTap = Effect.fn('Bot.gameListTap')(function* (
    user: MenuUser,
    game: SessionView,
    tap: { readonly op: string; readonly arg: string; readonly messageId: number }
) {
    const view = listViews[tap.op];

    if (!isDefined(view)) {
        return false;
    }

    const data = yield* loadNewGameData(user);
    yield* showGameList(user, game, data, { view, page: Number(tap.arg) || 0, notice: null, messageId: tap.messageId });

    return true;
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

    if (yield* listTap(user, game.value, { op, arg, messageId })) {
        return Option.none<string>();
    }

    if (op === 'pr') {
        return yield* runGameAction(
            user,
            { _tag: 'forward_poll', sessionId: game.value.id, chatId: String(user.tgUserId) },
            { messageId, revision: '' }
        );
    }

    const teams = op === 'kn' ? yield* teamsOf(game.value.id, Number(arg)) : Option.none<Action>();
    const action = Option.getOrNull(teams) ?? changeOf(user, game.value.id, { op, arg });

    if (!isDefined(action)) {
        return Option.some(menuText(user.locale, op === 'kn' ? 'noTeams' : 'stale'));
    }

    yield* showConfirm(user, action, messageId);

    return Option.none<string>();
});
