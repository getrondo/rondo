import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { postingChatsOf } from '@rondo/core/community/community.repository';
import { accountNamesOf } from '@rondo/core/identity/telegram-user';
import { isNoticeAction } from '@rondo/core/notify/notice-preview';
import { audienceOf } from '@rondo/core/signups/audience';
import * as Effect from 'effect/Effect';

import { menuText } from '../menu-text';
import { quotedTitles } from '../new-game/audience';

import type { MenuUser } from '../screen.interface';
import type { Action } from '@rondo/core/actions/action.model';

export interface GameTarget {
    readonly me: boolean;
    readonly where: string;
    readonly silent: boolean;
    readonly reached: { readonly sees: string; readonly told: string } | null;
}

export const targetOfAction = Effect.fn('Bot.targetOfAction')(function* (user: MenuUser, action: Action, sessionId: string) {
    const chats = yield* postingChatsOf(user.communityId);

    if (isNoticeAction(action) && isDefined(action.preview)) {
        const { targets } = action.preview;
        const self = String(user.tgUserId);
        const groups = chats.filter(chat => targets.some(target => target.chatId === String(chat.chatId))).map(chat => chat.title);
        const privates = targets.filter(target => !target.chatId.startsWith('-')).map(target => target.chatId);
        const others = privates.filter(chatId => chatId !== self);
        const names = yield* accountNamesOf(others.map(BigInt));
        const hasSelf = privates.includes(self);
        const phrase = (form: 'sees' | 'told') =>
            [
                ...groups.map(title => menuText(user.locale, `${form}Group`, { name: title })),
                ...others.map(chatId => menuText(user.locale, `${form}Other`, { name: names.get(chatId) ?? chatId })),
                ...(hasSelf ? [menuText(user.locale, `${form}Self`)] : [])
            ].join(user.locale === 'uk' ? ' і ' : ' и ');

        return {
            me: hasSelf && !isNotEmptyArray(groups) && !isNotEmptyArray(others),
            where: quotedTitles(groups, user.locale),
            silent: !isNotEmptyArray(targets),
            reached: { sees: phrase('sees'), told: phrase('told') }
        } satisfies GameTarget;
    }

    const titled = (ids: readonly bigint[]): GameTarget => ({
        silent: false,
        reached: null,
        me: false,
        where: quotedTitles(
            chats.filter(chat => ids.includes(chat.chatId)).map(chat => chat.title),
            user.locale
        )
    });
    const me: GameTarget = { me: true, where: '', silent: false, reached: null };

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
