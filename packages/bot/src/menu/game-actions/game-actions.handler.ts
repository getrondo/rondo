import * as Effect from 'effect/Effect';

import { menuText } from '../menu-text';

import type { MenuUser } from '../screen.interface';

export const handleGameTap = Effect.fn('Bot.handleGameTap')(function* (user: MenuUser, _parts: readonly string[], _messageId: number) {
    return yield* Effect.succeedSome(menuText(user.locale, 'stale'));
});
