import { loadAdminState } from '@rondo/core/menu/admin-state.repository';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { gameCardScreen } from './games.screen';
import { menuText } from './menu-text';
import { DoneSchema } from './new-game/draft';
import { showScreen } from './show-screen';
import { writeState } from './write-state';

import type { MenuUser } from './screen.interface';

const decodeDone = Schema.decodeUnknownOption(DoneSchema);

export const rememberDone = (
    user: MenuUser,
    at: { readonly messageId: number; readonly expected: number | null },
    done: Omit<typeof DoneSchema.Type, 'flow'>
) => writeState(user, { messageId: at.messageId, awaiting: null, draft: { flow: 'done', ...done } }, at.expected);

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

        if (Option.isNone(card)) {
            return Option.some(menuText(user.locale, key));
        }

        yield* showScreen(user.chatId, messageId, card.value);

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
