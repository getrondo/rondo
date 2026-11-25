import { isDefined } from '@rnw-community/shared';
import { clearAdminState, loadAdminState } from '@rondo/core/menu/admin-state.repository';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { fromShortId } from '../utils/from-short-id.util';

import { handleGameTap } from './game-actions/game-actions.handler';
import { gameCardScreen, gamesScreen } from './games.screen';
import { homeScreen } from './home.screen';
import { menuText } from './menu-text';
import { DraftSchema } from './new-game/draft';
import { handleNewGameTap, openNewGame } from './new-game/new-game.handler';
import { showScreen } from './show-screen';

import type { MenuUser } from './screen.interface';

const decodeDraft = Schema.decodeUnknownOption(DraftSchema);

const navigate = Effect.fn('Bot.navigate')(function* (user: MenuUser, parts: readonly string[], messageId: number) {
    yield* clearAdminState(user.tgUserId);
    const [, screen, id] = parts;

    if (screen === 'ng') {
        yield* openNewGame(user, messageId);

        return Option.none<string>();
    }

    if (screen === 'g') {
        const sessionId = fromShortId(id ?? '');

        if (!isDefined(sessionId)) {
            return Option.some(menuText(user.locale, 'stale'));
        }

        const card = yield* gameCardScreen(user, sessionId, null).pipe(Effect.option);

        if (Option.isNone(card)) {
            return Option.some(menuText(user.locale, 'unknownGame'));
        }

        yield* showScreen(user.chatId, messageId, card.value);

        return Option.none<string>();
    }

    const shown = screen === 'gl' ? yield* gamesScreen(user) : yield* homeScreen(user);
    yield* showScreen(user.chatId, messageId, shown);

    return Option.none<string>();
});

const newGameTap = Effect.fn('Bot.newGameTap')(function* (user: MenuUser, parts: readonly string[], messageId: number) {
    const [, revision, op = '', arg = ''] = parts;
    const state = yield* loadAdminState(user.tgUserId, user.now);
    const draft = state.pipe(Option.flatMap(row => decodeDraft(row.draft)));

    if (Option.isNone(state) || Option.isNone(draft) || state.value.messageId !== messageId || String(state.value.revision) !== revision) {
        return Option.some(menuText(user.locale, 'stale'));
    }

    return yield* handleNewGameTap(user, state.value, draft.value, { op, arg, messageId });
});

export const handleMenuTap = Effect.fn('Bot.handleMenuTap')(function* (user: MenuUser, data: string, messageId: number) {
    const parts = data.split(':');

    const [kind = ''] = parts;

    switch (kind) {
        case 'm': {
            return yield* navigate(user, parts, messageId);
        }
        case 'n': {
            return yield* newGameTap(user, parts, messageId);
        }
        case 'c': {
            return yield* handleGameTap(user, parts, messageId);
        }
        default: {
            return Option.some(menuText(user.locale, 'stale'));
        }
    }
});
