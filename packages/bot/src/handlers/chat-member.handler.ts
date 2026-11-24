import { findCommunityByChat } from '@rondo/core/community/community.repository';
import { syncMember } from '@rondo/core/identity/telegram-user';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { toTelegramUser } from '../context/telegram-user.mapper';

import type { ChatMember, ChatMemberUpdated, User } from 'grammy/types';

const presenceOf = (member: ChatMember): 'active' | 'left' | 'removed' => {
    if (member.status === 'kicked') {
        return 'removed';
    }

    return member.status === 'left' || (member.status === 'restricted' && !member.is_member) ? 'left' : 'active';
};

export const syncGroupUsers = Effect.fn('Bot.syncGroupUsers')(function* (
    communityId: string,
    users: readonly User[],
    presence: 'active' | 'left'
) {
    for (const user of users.filter(({ is_bot: isBot }) => !isBot)) {
        yield* syncMember(communityId, toTelegramUser(user), presence);
    }
});

export const handleChatMember = Effect.fn('Bot.handleChatMember')(function* (update: ChatMemberUpdated) {
    const communityId = yield* findCommunityByChat(BigInt(update.chat.id));
    const member = update.new_chat_member;

    if (Option.isSome(communityId) && !member.user.is_bot) {
        yield* syncMember(communityId.value, toTelegramUser(member.user), presenceOf(member));
    }
});
