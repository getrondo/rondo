// Message ids of several chats collide, so an import numbers posts by the place of their chat: 0 is the main chat
import type { CommunityConfig } from '../config/community-config';

const chatRange = 2 ** 32;

export const postIdOf = (chatPlace: number, messageId: number): number => chatPlace * chatRange + messageId;

export const sourceOf = (otherChats: CommunityConfig['otherChats'], postId: number) => ({
    chatId: otherChats?.[Math.floor(postId / chatRange) - 1]?.chatId ?? null,
    messageId: postId % chatRange
});

export const postIdIn = (
    otherChats: CommunityConfig['otherChats'],
    { chatId, messageId }: { readonly chatId: number | null; readonly messageId: number }
): number => postIdOf(1 + (otherChats ?? []).findIndex(chat => chat.chatId === chatId), messageId);
