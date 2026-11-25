import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { linkedChatsOf } from '@rondo/core/community/community.repository';
import { isNoticeAction } from '@rondo/core/notify/notice-preview';
import { audienceOf } from '@rondo/core/signups/audience';
import * as Effect from 'effect/Effect';

import { quotedTitles } from '../new-game/audience';

import type { MenuUser } from '../screen.interface';
import type { Action } from '@rondo/core/actions/action.model';

export interface GameTarget {
    readonly me: boolean;
    readonly where: string;
    readonly silent: boolean;
    readonly alsoMe: boolean;
}

export const targetOfAction = Effect.fn('Bot.targetOfAction')(function* (user: MenuUser, action: Action, sessionId: string) {
    const chats = yield* linkedChatsOf(user.communityId);

    if (isNoticeAction(action) && isDefined(action.preview)) {
        const { targets } = action.preview;
        const groups = chats.filter(chat => targets.some(target => target.chatId === String(chat.chatId)));
        const hasPrivate = targets.some(target => !target.chatId.startsWith('-'));

        return {
            me: hasPrivate && !isNotEmptyArray(groups),
            where: quotedTitles(
                groups.map(chat => chat.title),
                user.locale
            ),
            silent: !isNotEmptyArray(targets),
            alsoMe: hasPrivate && isNotEmptyArray(groups)
        } satisfies GameTarget;
    }

    const titled = (ids: readonly bigint[]): GameTarget => ({
        silent: false,
        alsoMe: false,
        me: false,
        where: quotedTitles(
            chats.filter(chat => ids.includes(chat.chatId)).map(chat => chat.title),
            user.locale
        )
    });
    const me: GameTarget = { me: true, where: '', silent: false, alsoMe: false };

    if ((action._tag === 'announce_session' || action._tag === 'forward_poll') && isDefined(action.chatId)) {
        return action.chatId === String(user.tgUserId) ? me : titled([BigInt(action.chatId)]);
    }

    const audience = yield* audienceOf(sessionId);
    const groups = audience.filter(target => target.chatId < 0n).map(target => target.chatId);

    if (isNotEmptyArray(groups)) {
        return titled(groups);
    }

    const [first] = chats;

    return isNotEmptyArray(audience) || !isDefined(first) ? me : titled([first.chatId]);
});
