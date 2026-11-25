import { loadAdminState } from '@rondo/core/menu/admin-state.repository';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { toShortId } from '../utils/to-short-id.util';

import { gameCardScreen } from './games.screen';
import { menuText, type MenuKey } from './menu-text';
import { DoneSchema } from './new-game/draft';
import { showScreen } from './show-screen';
import { writeState } from './write-state';

import type { MenuUser, Screen } from './screen.interface';

const decodeDone = Schema.decodeUnknownOption(DoneSchema);

export const rememberDone = (
    user: MenuUser,
    at: { readonly messageId: number; readonly expected: number | null },
    done: Omit<typeof DoneSchema.Type, 'flow'>
) => writeState(user, { messageId: at.messageId, awaiting: null, draft: { flow: 'done', ...done } }, at.expected);

export const plainReceipt = (user: MenuUser, sessionId: string, key: MenuKey): Screen => ({
    text: menuText(user.locale, key),
    keyboard: [
        [
            { text: menuText(user.locale, 'games'), callback_data: 'm:gl' },
            { text: menuText(user.locale, 'edit'), callback_data: `m:g:${toShortId(sessionId)}` }
        ]
    ]
});

export const showAfterSuccess = Effect.fn('Bot.showAfterSuccess')(function* <Failure, Requirements>(
    user: MenuUser,
    messageId: number,
    shown: Effect.Effect<unknown, Failure, Requirements>,
    fallback: Screen
) {
    const exit = yield* Effect.exit(shown);

    if (Exit.isFailure(exit)) {
        yield* Effect.logError('[menu] screen after a success not shown', exit.cause);
        yield* showScreen(user.chatId, messageId, fallback);
    }
});

export const replyStale = Effect.fn('Bot.replyStale')(function* (user: MenuUser, messageId: number, revision: string) {
    const state = yield* loadAdminState(user.tgUserId, user.now);
    const done = state.pipe(
        Option.filter(row => row.messageId === messageId),
        Option.flatMap(row => decodeDone(row.draft)),
        Option.filter(value => value.revision === revision)
    );

    if (Option.isSome(done)) {
        const key = done.value.created ? 'alreadyCreated' : 'alreadyDone';
        const receipt = { text: menuText(user.locale, key), saysPoll: done.value.created };
        const card = done.value.self ? Option.none() : yield* gameCardScreen(user, done.value.sessionId, receipt).pipe(Effect.option);
        yield* showScreen(
            user.chatId,
            messageId,
            Option.getOrElse(card, () => plainReceipt(user, done.value.sessionId, key))
        );

        return Option.none<string>();
    }

    if (Option.isSome(state) && state.value.messageId === messageId) {
        return Option.some(menuText(user.locale, 'stale'));
    }

    yield* showScreen(user.chatId, messageId, {
        text: menuText(user.locale, 'staleScreen'),
        keyboard: [[{ text: menuText(user.locale, 'newGame'), callback_data: 'm:ng' }]]
    });

    return Option.some(menuText(user.locale, 'stale'));
});
