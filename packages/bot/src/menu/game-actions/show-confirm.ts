import { isDefined } from '@rnw-community/shared';
import { ActionSchema, type Action } from '@rondo/core/actions/action.model';
import { describeAction } from '@rondo/core/actions/describe-action';
import { linkedChatsOf } from '@rondo/core/community/community.repository';
import { moveAdminMessage } from '@rondo/core/menu/admin-state.repository';
import { isNoticeAction, noticeOf } from '@rondo/core/notify/notice-preview';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Predicate from 'effect/Predicate';
import * as Schema from 'effect/Schema';

import { actionContextFor } from '../../context/action-context';
import { showScreen } from '../show-screen';
import { writeState } from '../write-state';

import { confirmScreen } from './game-actions.screens';
import { awaitingOfView, sessionOf, type GameDraft, type GameListView } from './game-draft';
import { gameListScreen } from './game-lists';

import type { MenuKey } from '../menu-text';
import type { NewGameData } from '../new-game/draft';
import type { MenuUser } from '../screen.interface';
import type { SessionView } from '@rondo/core/sessions/session.model';

const encodeAction = Schema.encodeEffect(ActionSchema);

export interface ScreenAt {
    readonly messageId: number | null;
    readonly expected: number | null;
}

const saveGameDraft = (user: MenuUser, draft: GameDraft, at: ScreenAt) =>
    writeState(user, { messageId: at.messageId, awaiting: awaitingOfView[draft.view] ?? null, draft }, at.expected);

const placeScreen = Effect.fn('Bot.placeGameScreen')(function* (
    user: MenuUser,
    at: ScreenAt & { readonly revision: number },
    shownId: number
) {
    if (shownId !== at.messageId) {
        yield* moveAdminMessage(user.tgUserId, shownId, at.revision);
    }
});

const withDestination = Effect.fn('Bot.withDestination')(function* (
    user: MenuUser,
    action: Extract<Action, { _tag: 'announce_session' | 'forward_poll' }>
) {
    const self = String(user.tgUserId);

    if (action.chatId === self) {
        return action;
    }

    const chats = yield* linkedChatsOf(user.communityId);
    const chat = isDefined(action.chatId) ? chats.find(entry => String(entry.chatId) === action.chatId) : chats[0];

    if (!isDefined(chat)) {
        return action;
    }

    return { ...action, chatId: String(chat.chatId), topicId: Predicate.isUndefined(action.topicId) ? chat.topicId : action.topicId };
});

const withPreview = Effect.fn('Bot.withPreview')(function* (user: MenuUser, action: Action) {
    if (action._tag === 'announce_session' || action._tag === 'forward_poll') {
        return yield* withDestination(user, action);
    }

    if (!isNoticeAction(action)) {
        return action;
    }

    const context = yield* actionContextFor(user.tgUserId)(user.communityId);
    const preview = yield* noticeOf(action, context);

    return { ...action, preview };
});

export const showConfirm = Effect.fn('Bot.showGameConfirm')(function* (
    user: MenuUser,
    proposed: Action,
    at: ScreenAt,
    notice: string | null = null
) {
    const action = yield* withPreview(user, proposed);
    const encoded = yield* encodeAction(action).pipe(Effect.orDie);
    const summary = action._tag === 'announce_session' ? yield* describeAction(action, user.locale, user.communityId) : null;
    const draft: GameDraft = { flow: 'game', view: 'confirm', page: 0, sessionId: sessionOf(action), action: encoded, summary };
    const saved = yield* saveGameDraft(user, draft, at);

    if (Option.isNone(saved)) {
        return;
    }

    const screen = yield* confirmScreen(user, action, saved.value.revision, notice);
    const shownId = yield* showScreen(user.chatId, at.messageId, screen);
    yield* placeScreen(user, { ...at, revision: saved.value.revision }, shownId);
});

export const showGameList = Effect.fn('Bot.showGameList')(function* (
    user: MenuUser,
    game: SessionView,
    data: NewGameData,
    list: { readonly view: GameListView; readonly page: number; readonly notice: MenuKey | null; readonly at: ScreenAt }
) {
    const draft: GameDraft = { flow: 'game', view: list.view, page: list.page, sessionId: game.id, action: null, summary: null };
    const saved = yield* saveGameDraft(user, draft, list.at);

    if (Option.isNone(saved)) {
        return;
    }

    const shownId = yield* showScreen(user.chatId, list.at.messageId, gameListScreen(user, game, data, list));
    yield* placeScreen(user, { ...list.at, revision: saved.value.revision }, shownId);
});
