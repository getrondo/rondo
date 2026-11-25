import { ActionSchema, type Action } from '@rondo/core/actions/action.model';
import { moveAdminMessage, saveAdminState } from '@rondo/core/menu/admin-state.repository';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

import { showScreen } from '../show-screen';

import { confirmScreen } from './game-actions.screens';
import { awaitingOfView, sessionOf, type GameDraft, type GameListView } from './game-draft';
import { gameListScreen } from './game-lists';

import type { MenuKey } from '../menu-text';
import type { NewGameData } from '../new-game/draft';
import type { MenuUser } from '../screen.interface';
import type { SessionView } from '@rondo/core/sessions/session.model';

const encodeAction = Schema.encodeEffect(ActionSchema);

const saveGameDraft = Effect.fn('Bot.saveGameDraft')(function* (user: MenuUser, draft: GameDraft, messageId: number | null) {
    return yield* saveAdminState({
        tgUserId: user.tgUserId,
        communityId: user.communityId,
        messageId,
        awaiting: awaitingOfView[draft.view] ?? null,
        draft,
        now: user.now
    });
});

const placeScreen = Effect.fn('Bot.placeGameScreen')(function* (user: MenuUser, messageId: number | null, shownId: number) {
    if (shownId !== messageId) {
        yield* moveAdminMessage(user.tgUserId, shownId);
    }
});

export const showConfirm = Effect.fn('Bot.showGameConfirm')(function* (user: MenuUser, action: Action, messageId: number | null) {
    const encoded = yield* encodeAction(action).pipe(Effect.orDie);
    const draft: GameDraft = { flow: 'game', view: 'confirm', page: 0, sessionId: sessionOf(action), action: encoded, summary: null };
    const saved = yield* saveGameDraft(user, draft, messageId);
    const screen = yield* confirmScreen(user, action, saved.revision);
    const shownId = yield* showScreen(user.chatId, messageId, screen);
    yield* placeScreen(user, messageId, shownId);
});

export const showGameList = Effect.fn('Bot.showGameList')(function* (
    user: MenuUser,
    game: SessionView,
    data: NewGameData,
    list: { readonly view: GameListView; readonly page: number; readonly notice: MenuKey | null; readonly messageId: number | null }
) {
    const draft: GameDraft = { flow: 'game', view: list.view, page: list.page, sessionId: game.id, action: null, summary: null };
    yield* saveGameDraft(user, draft, list.messageId);
    const shownId = yield* showScreen(user.chatId, list.messageId, gameListScreen(user, game, data, list));
    yield* placeScreen(user, list.messageId, shownId);
});
