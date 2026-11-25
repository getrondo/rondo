import { isDefined } from '@rnw-community/shared';
import { findLinkedChat } from '@rondo/core/community/community.repository';
import { findKnownChat } from '@rondo/core/community/group-settings';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { isTopicAwaited } from '../menu/groups/topic-awaited';

import type { Message, TelegramUpdate } from '@rondo/telegram/webhook/telegram-update.model';

const chatOf = (update: TelegramUpdate) => {
    if ('message' in update) {
        return update.message.chat;
    }

    return 'chat_member' in update ? update.chat_member.chat : null;
};

const isExpected = Effect.fn('Bot.isExpected')(function* ({ chat, from, migrate_to_chat_id: migratedTo }: Message) {
    if (isDefined(migratedTo)) {
        const known = yield* findKnownChat(chat.id);

        return Option.isSome(known);
    }

    return isDefined(from) && (yield* isTopicAwaited(from.id, chat.id));
});

// What is said in a chat the bot was not linked to is none of its business: nothing is stored, not even the update
export const isForeign = Effect.fn('Bot.isForeign')(function* (update: TelegramUpdate) {
    const chat = chatOf(update);

    if (!isDefined(chat) || chat.type === 'private') {
        return false;
    }

    const linked = yield* findLinkedChat(BigInt(chat.id));

    return Option.isNone(linked) && !('message' in update && (yield* isExpected(update.message)));
});
