import { isDefined } from '@rnw-community/shared';
import { replaceAdminState, saveAdminState } from '@rondo/core/menu/admin-state.repository';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import type { MenuUser } from './screen.interface';

export interface StateWrite {
    readonly messageId: number | null;
    readonly awaiting: string | null;
    readonly draft: unknown;
}

// With an expected revision the write lands only on the row that was loaded, so a late writer changes nothing
export const writeState = Effect.fn('Bot.writeState')(function* (user: MenuUser, state: StateWrite, expected: number | null) {
    const input = { tgUserId: user.tgUserId, communityId: user.communityId, now: user.now, ...state };

    if (isDefined(expected)) {
        return yield* replaceAdminState(input, expected);
    }

    const saved = yield* saveAdminState(input);

    return Option.fromNullishOr(saved);
});
