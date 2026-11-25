// Message ids of several chats collide, so an import numbers posts by the place of their chat: 0 is the main chat
import { isDefined } from '@rnw-community/shared';
import * as Option from 'effect/Option';

import type { CommunityConfig } from '@rondo/core/config/community-config';

const chatRange = 2 ** 32;

export const postIdOf = (chatPlace: number, messageId: number): number => chatPlace * chatRange + messageId;

export const sourceOf = (otherChats: CommunityConfig['otherChats'], postId: number) => ({
    chatId: otherChats?.[Math.floor(postId / chatRange) - 1]?.chatId ?? null,
    messageId: postId % chatRange
});

interface KnownChats {
    readonly mainChatId: Option.Option<number>;
    readonly otherChats: CommunityConfig['otherChats'];
}

export const postIdIn = (
    { mainChatId, otherChats }: KnownChats,
    { chatId, messageId }: { readonly chatId: number | null; readonly messageId: number }
): Option.Option<number> => {
    const place = [Option.getOrNull(mainChatId), ...(otherChats ?? []).map(chat => chat.chatId)].indexOf(chatId);

    return !isDefined(chatId) || place !== -1 ? Option.some(postIdOf(Math.max(place, 0), messageId)) : Option.none();
};
