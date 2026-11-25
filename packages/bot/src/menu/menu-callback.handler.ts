import { isDefined } from '@rnw-community/shared';
import { clearAdminState, loadAdminState } from '@rondo/core/menu/admin-state.repository';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { fromShortId } from '../utils/from-short-id.util';

import { handleGameTap } from './game-actions/game-actions.handler';
import { gameCardPage, gamesScreen, pastGamesScreen } from './games.screen';
import { homeScreen } from './home.screen';
import { menuText } from './menu-text';
import { DraftSchema } from './new-game/draft';
import { continueNewGame, handleNewGameTap, liveDraftElsewhere, openNewGame } from './new-game/new-game.handler';
import { showScreen } from './show-screen';
import { replyStale } from './stale-reply';
import { handleTeamsTap } from './teams/teams.handler';

import type { MenuUser } from './screen.interface';

const decodeDraft = Schema.decodeUnknownOption(DraftSchema);

const navigate = Effect.fn('Bot.navigate')(function* (user: MenuUser, parts: readonly string[], messageId: number) {
    yield* clearAdminState(user.tgUserId, { messageId, now: user.now });
    const [, screen, id, page] = parts;

    const live = screen === 'ng' ? yield* liveDraftElsewhere(user, messageId) : Option.none();

    if (Option.isSome(live)) {
        yield* showScreen(user.chatId, messageId, {
            text: menuText(user.locale, 'ngLive'),
            keyboard: [
                [{ text: menuText(user.locale, 'ngContinue'), callback_data: 'm:ngc' }],
                [{ text: menuText(user.locale, 'ngRestart'), callback_data: 'm:ngn' }]
            ]
        });

        return Option.none<string>();
    }

    if (screen === 'ngc') {
        yield* continueNewGame(user, messageId);

        return Option.none<string>();
    }

    if (screen === 'ng' || screen === 'ngn') {
        yield* openNewGame(user, messageId);

        return Option.none<string>();
    }

    if (screen === 'g') {
        const sessionId = fromShortId(id ?? '');

        if (!isDefined(sessionId)) {
            return Option.some(menuText(user.locale, 'stale'));
        }

        const card = yield* gameCardPage(user, sessionId, null, Number(page ?? '0') || 0).pipe(Effect.option);

        if (Option.isNone(card)) {
            return Option.some(menuText(user.locale, 'unknownGame'));
        }

        yield* showScreen(user.chatId, messageId, card.value);

        return Option.none<string>();
    }

    const screens: Readonly<Record<string, typeof homeScreen>> = { gl: gamesScreen, gp: pastGamesScreen };
    const shown = yield* (screens[screen ?? ''] ?? homeScreen)(user);
    yield* showScreen(user.chatId, messageId, shown);

    return Option.none<string>();
});

const sendingOps = new Set(['ok', 'sv']);

const newGameTap = Effect.fn('Bot.newGameTap')(function* (user: MenuUser, parts: readonly string[], messageId: number) {
    const [, revision = '', op = '', arg = ''] = parts;
    const state = yield* loadAdminState(user.tgUserId, user.now);
    const draft = state.pipe(Option.flatMap(row => decodeDraft(row.draft)));

    if (Option.isNone(state) || Option.isNone(draft) || state.value.messageId !== messageId) {
        return yield* replyStale(user, messageId, revision);
    }

    const live = String(state.value.revision) === revision;

    return yield* handleNewGameTap(user, state.value, draft.value, { op: live || !sendingOps.has(op) ? op : 'redraw', arg, messageId });
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
        case 't': {
            return yield* handleTeamsTap(user, data, messageId);
        }
        default: {
            return Option.some(menuText(user.locale, 'stale'));
        }
    }
});
