import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { telegramPoll } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { Telegram, type CallOptions } from '@rondo/telegram/service/telegram.service';
import { and, eq, inArray } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';

import { isApproverOf } from '../community/group-settings';
import { ActionFailedError } from '../error/action-failed.error';
import { pollChatsOf } from '../signups/poll-chats';
import { topicOptions } from '../utils/topic-options.util';

import type { GroupTarget } from '../interface/group-target.interface';
import type { PollText } from '../interface/poll.interface';

// Who allowed a write to a group: the approver with a ✅, or a switch of the group
export type Approval = { readonly _tag: 'approver'; readonly tgUserId: bigint } | { readonly _tag: 'mention' };

type ChatContent =
    | { readonly _tag: 'text'; readonly html: string; readonly hasLinkPreview: boolean }
    | { readonly _tag: 'edit'; readonly messageId: number; readonly html: string }
    | { readonly _tag: 'poll'; readonly poll: PollText }
    | { readonly _tag: 'forward'; readonly fromChatId: bigint; readonly messageId: number }
    | { readonly _tag: 'pin'; readonly messageId: number }
    | { readonly _tag: 'stop_poll'; readonly messageId: number };

interface ChatWrite {
    readonly target: GroupTarget;
    readonly approval: Approval | null;
    readonly content: ChatContent;
    readonly options?: Pick<CallOptions, 'maxWaitSeconds'>;
}

const refused = (code: 'group_off' | 'not_approved' | 'preview_changed') => ActionFailedError.make({ failure: { code } });

const isAllowed = (chat: typeof telegramChat.$inferSelect, approval: Approval, content: ChatContent) => {
    switch (approval._tag) {
        case 'approver': {
            return isApproverOf(approval.tgUserId, chat.communityId);
        }
        case 'mention': {
            return Effect.succeed(chat.isMentioning && content._tag === 'text');
        }
        default: {
            return Effect.succeed(false);
        }
    }
};

// Closing a poll closes its forwarded copies too, so it writes to every linked group that has one
const copyChats = Effect.fn('Core.copyChats')(function* (chatId: bigint, messageId: number) {
    const db = yield* Db;
    const [poll] = yield* db
        .select({ pollId: telegramPoll.pollId, sessionId: telegramPoll.sessionId })
        .from(telegramPoll)
        .where(and(eq(telegramPoll.chatId, chatId), eq(telegramPoll.messageId, messageId)));
    const chatIds = isDefined(poll) ? yield* pollChatsOf(poll.sessionId) : [];

    return isNotEmptyArray(chatIds) ? yield* db.select().from(telegramChat).where(inArray(telegramChat.chatId, chatIds)) : [];
});

const requireChat = Effect.fn('Core.requireGroupPass')(function* (
    chat: typeof telegramChat.$inferSelect | undefined,
    { target, approval, content }: ChatWrite
) {
    if (!isDefined(chat) || !chat.isPosting) {
        return yield* refused('group_off');
    }

    if (!isDefined(approval) || !(yield* isAllowed(chat, approval, content))) {
        return yield* refused('not_approved');
    }

    return chat.topicId !== target.topicId && ['text', 'poll', 'forward'].includes(content._tag) ? yield* refused('preview_changed') : chat;
});

const requirePass = Effect.fn('Core.requirePass')(function* (write: ChatWrite) {
    const db = yield* Db;
    const { target, content } = write;

    if (target.chatId <= 0n) {
        const [chat] = yield* db.select().from(telegramChat).where(eq(telegramChat.chatId, target.chatId));
        yield* requireChat(chat, write);
    }

    for (const copy of content._tag === 'stop_poll' ? yield* copyChats(target.chatId, content.messageId) : []) {
        yield* requireChat(copy, write);
    }
});

const sent = (messageId: number, pollId = '', voters: number | null = null) => ({ messageId, pollId, voters });

// The only place that writes to a chat. A group gets nothing unless it is linked, switched on and the content approved
export const writeToChat = Effect.fn('Core.writeToChat')(function* (write: ChatWrite) {
    const telegram = yield* Telegram;
    const { target, content } = write;
    const options = { ...write.options, guard: requirePass(write) };
    const chatId = Number(target.chatId);

    yield* requirePass(write);

    switch (content._tag) {
        case 'text': {
            const preview = content.hasLinkPreview ? {} : { link_preview_options: { is_disabled: true } };
            const message = yield* telegram.call(
                'sendMessage',
                api => api.sendMessage(chatId, content.html, { parse_mode: 'HTML', ...preview, ...topicOptions(target) }),
                options
            );

            return sent(message.message_id);
        }
        case 'edit': {
            yield* telegram.call(
                'editMessageText',
                api =>
                    api.editMessageText(chatId, content.messageId, content.html, {
                        parse_mode: 'HTML',
                        link_preview_options: { is_disabled: true }
                    }),
                options
            );

            return sent(content.messageId);
        }
        case 'poll': {
            const { question, answers, description, route } = content.poll;
            const message = yield* telegram.call(
                'sendPoll',
                api =>
                    api.sendPoll(
                        chatId,
                        question,
                        answers.map(answer => ({ text: answer })),
                        {
                            is_anonymous: false,
                            allows_multiple_answers: false,
                            ...(isDefined(description) ? { description, description_parse_mode: 'HTML' } : {}),
                            ...(isDefined(route) ? { reply_markup: { inline_keyboard: [[{ text: route.label, url: route.url }]] } } : {}),
                            ...topicOptions(target)
                        }
                    ),
                options
            );

            return sent(message.message_id, message.poll.id);
        }
        case 'forward': {
            const message = yield* telegram.call(
                'forwardMessage',
                api => api.forwardMessage(chatId, Number(content.fromChatId), content.messageId, topicOptions(target)),
                options
            );

            return sent(message.message_id);
        }
        case 'pin': {
            yield* telegram.call('pinChatMessage', api => api.pinChatMessage(chatId, content.messageId, { disable_notification: true }));

            return sent(content.messageId);
        }
        case 'stop_poll': {
            const poll = yield* telegram.call('stopPoll', api => api.stopPoll(chatId, content.messageId), options);

            return sent(content.messageId, poll.id, Predicate.isNumber(poll.total_voter_count) ? poll.total_voter_count : null);
        }
        default: {
            return yield* Effect.die(new Error('unknown content'));
        }
    }
});
