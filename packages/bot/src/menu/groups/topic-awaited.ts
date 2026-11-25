import { linkChat } from '@rondo/core/community/chat-links';
import { findLinkedChat } from '@rondo/core/community/community.repository';
import { findKnownChat } from '@rondo/core/community/group-settings';
import { personIdOfTelegramUser } from '@rondo/core/identity/telegram-user';
import { clearAdminState, loadAdminState } from '@rondo/core/menu/admin-state.repository';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { menuText } from '../menu-text';

import { tellApprover } from './tell';

export const topicAwaited = 'group_topic';

const decodeDraft = Schema.decodeUnknownOption(Schema.Struct({ chatId: Schema.Int }));

// The approver said they would write in the topic, and nobody else's message counts
export const isTopicAwaited = Effect.fn('Bot.isTopicAwaited')(function* (tgUserId: number, chatId: number) {
    const now = yield* DateTime.nowAsDate;
    const state = yield* loadAdminState(BigInt(tgUserId), now);

    return state.pipe(
        Option.filter(({ awaiting }) => awaiting === topicAwaited),
        Option.flatMap(({ draft }) => decodeDraft(draft)),
        Option.exists(draft => draft.chatId === chatId)
    );
});

export const bindTopic = Effect.fn('Bot.bindTopic')(function* (tgUserId: number, chatId: number, topicId: number | null) {
    const known = yield* findKnownChat(chatId);

    if (Option.isNone(known)) {
        return;
    }

    const { communityId, chat } = known.value;
    const linked = yield* findLinkedChat(BigInt(chatId));
    yield* linkChat({ communityId, chatId: BigInt(chatId), topicId, actorPersonId: yield* personIdOfTelegramUser(BigInt(tgUserId)) });
    yield* clearAdminState(BigInt(tgUserId));
    yield* tellApprover(communityId, locale => ({
        text: menuText(locale, Option.isSome(linked) ? 'groupTopicSet' : 'groupLinkedTopic', { title: escapeHtml(chat.title) }),
        keyboard: [[{ text: menuText(locale, 'groupOpen'), callback_data: `g:s:${chatId}` }]]
    }));
});
