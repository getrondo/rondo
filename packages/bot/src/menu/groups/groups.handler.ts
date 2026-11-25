import { isDefined } from '@rnw-community/shared';
import { Access } from '@rondo/core/access/admin-access';
import { linkChat, setChatSwitch, unlinkChat } from '@rondo/core/community/chat-links';
import { findLinkedChat, linkedChatsOf } from '@rondo/core/community/community.repository';
import { findKnownChat, isApproverOf } from '@rondo/core/community/group-settings';
import { personIdOfTelegramUser } from '@rondo/core/identity/telegram-user';
import { clearAdminState, saveAdminState } from '@rondo/core/menu/admin-state.repository';
import { escapeHtml } from '@rondo/telegram/format/html';
import { Telegram } from '@rondo/telegram/service/telegram.service';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { menuText } from '../menu-text';
import { showScreen } from '../show-screen';

import { askScreen, groupScreen, groupsScreen, leaveScreen } from './groups.screen';
import { topicAwaited } from './topic-awaited';

import type { MenuUser } from '../screen.interface';

interface GroupTap {
    readonly chatId: number;
    readonly messageId: number;
}

const showGroup = Effect.fn('Bot.showGroup')(function* (user: MenuUser, { chatId, messageId }: GroupTap, header: string) {
    const chats = yield* linkedChatsOf(user.communityId);
    const chat = chats.find(entry => entry.chatId === BigInt(chatId));
    const screen = isDefined(chat) ? groupScreen(user.locale, chat, header) : yield* groupsScreen(user);
    yield* showScreen(user.chatId, messageId, screen);
});

// The title Telegram knows, none when the bot is not in the group
const liveTitle = Effect.fn('Bot.liveTitle')(function* (chatId: number) {
    const telegram = yield* Telegram;
    const chat = yield* telegram.call('getChat', api => api.getChat(chatId)).pipe(Effect.option);

    return chat.pipe(Option.map(({ title }) => title ?? ''));
});

const decide = Effect.fn('Bot.decideGroup')(function* (user: MenuUser, op: string, tap: GroupTap) {
    const { chatId, messageId } = tap;
    const known = yield* findKnownChat(chatId);
    const linked = yield* findLinkedChat(BigInt(chatId));
    const live = op === 'q' || op === 'y' ? yield* liveTitle(chatId) : linked.pipe(Option.map(chat => chat.title));
    const settings = known.pipe(Option.map(({ chat }) => chat.title));
    const title = escapeHtml(Option.getOrElse(live, () => Option.getOrElse(settings, () => '')));
    const chat = { communityId: user.communityId, chatId: BigInt(chatId), actorPersonId: yield* personIdOfTelegramUser(user.tgUserId) };

    switch (op) {
        case 'q':
        case 'y': {
            if (Option.isNone(live) || Option.isNone(known)) {
                const groups = yield* groupsScreen(user);

                return yield* showScreen(user.chatId, messageId, { ...groups, text: menuText(user.locale, 'groupNotIn', { title }) });
            }

            if (op === 'q') {
                return yield* showScreen(user.chatId, messageId, askScreen(user.locale, known.value.chat, live.value));
            }

            yield* linkChat({ ...chat, title: live.value });

            return yield* showGroup(user, tap, menuText(user.locale, 'groupLinked', { title }));
        }
        case 't': {
            yield* saveAdminState({
                tgUserId: user.tgUserId,
                communityId: user.communityId,
                messageId,
                awaiting: topicAwaited,
                draft: { chatId },
                now: user.now
            });

            return yield* showScreen(user.chatId, messageId, {
                text: menuText(user.locale, 'groupTopicAsk', { title }),
                keyboard: [[{ text: menuText(user.locale, 'groupTopicCancel'), callback_data: `g:k:${chatId}` }]]
            });
        }
        case 'k': {
            yield* clearAdminState(user.tgUserId);

            return yield* showGroup(user, tap, '');
        }
        case 'u': {
            yield* unlinkChat(chat);

            return yield* showScreen(
                user.chatId,
                messageId,
                leaveScreen(user.locale, chatId, menuText(user.locale, 'groupUnlinked', { title }))
            );
        }
        case 'p1': {
            yield* setChatSwitch(chat, { isPosting: true });

            return yield* showGroup(user, tap, '');
        }
        case 'm0':
        case 'm1': {
            yield* setChatSwitch(chat, { isMentioning: op === 'm1' });

            return yield* showGroup(user, tap, '');
        }
        default: {
            return yield* showScreen(
                user.chatId,
                messageId,
                leaveScreen(user.locale, chatId, menuText(user.locale, 'groupDeclined', { title }))
            );
        }
    }
});

const leave = Effect.fn('Bot.leaveGroup')(function* (user: MenuUser, { chatId, messageId }: GroupTap) {
    const telegram = yield* Telegram;
    const left = yield* telegram
        .call('leaveChat', api => api.leaveChat(chatId))
        .pipe(
            Effect.as('groupLeft' as const),
            Effect.catchTag('TelegramApiError', error =>
                Effect.logWarning('[groups] not left', error).pipe(Effect.as('groupNotLeft' as const))
            )
        );
    yield* showScreen(user.chatId, messageId, { text: menuText(user.locale, left), keyboard: [] });
});

// Anyone may look and stop the bot, only the approver may let it into a group
export const handleGroupTap = Effect.fn('Bot.handleGroupTap')(function* (user: MenuUser, parts: readonly string[], messageId: number) {
    const [, op = '', ...args] = parts;
    const chatId = Number(args.at(-1));
    const tap = { chatId, messageId };

    if (op === 'a' || !Number.isSafeInteger(chatId)) {
        const screen = yield* groupsScreen(user);
        yield* showScreen(user.chatId, messageId, screen);

        return Option.none<string>();
    }

    if (op === 's') {
        yield* showGroup(user, tap, '');

        return Option.none<string>();
    }

    const isApprover = yield* isApproverOf(user.tgUserId, user.communityId);
    const { ownerTgUserIds } = yield* Access;

    if (op === 'p' && args[0] === '0') {
        yield* setChatSwitch(
            { communityId: user.communityId, chatId: BigInt(chatId), actorPersonId: yield* personIdOfTelegramUser(user.tgUserId) },
            { isPosting: false }
        );
        yield* showGroup(user, tap, '');

        return Option.none<string>();
    }

    if (op === 'l' && (isApprover || ownerTgUserIds.has(user.tgUserId))) {
        yield* leave(user, tap);

        return Option.none<string>();
    }

    if (!isApprover) {
        return Option.some(menuText(user.locale, 'groupOnlyApprover'));
    }

    yield* decide(user, op === 'p' || op === 'm' ? `${op}${args[0]}` : op, tap);

    return Option.none<string>();
});
