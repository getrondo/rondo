import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { setChatSwitch } from '@rondo/core/community/chat-links';
import { findLinkedChat } from '@rondo/core/community/community.repository';
import { findKnownChat } from '@rondo/core/community/group-settings';
import { community } from '@rondo/db/schema/org.schema';
import { auditLog } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { escapeHtml } from '@rondo/telegram/format/html';
import { and, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { askScreen, leaveScreen } from '../menu/groups/groups.screen';
import { tellApprover, tellOwners } from '../menu/groups/tell';
import { menuText } from '../menu/menu-text';

import { presenceOf } from './chat-member.handler';

import type { Locale } from '@rondo/core/i18n/locale';
import type { ChatMember, ChatMemberUpdated } from '@rondo/telegram/webhook/telegram-update.model';

const isPresent = (member: ChatMember | undefined): boolean => isDefined(member) && presenceOf(member) === 'active';

const rightsMissing = (locale: Locale, member: ChatMember): string[] => [
    ...(member.status === 'restricted' && (member.can_send_messages !== true || member.can_send_polls !== true)
        ? [menuText(locale, 'rightSend')]
        : []),
    ...(member.status !== 'administrator' || member.can_pin_messages !== true ? [menuText(locale, 'rightPin')] : [])
];

const withRights = (locale: Locale, member: ChatMember, title: string): string[] => {
    const rights = rightsMissing(locale, member);

    return isNotEmptyArray(rights) ? [menuText(locale, 'groupRights', { title: escapeHtml(title), rights: rights.join(', ') })] : [];
};

// Once per chat, or a stranger could make the bot write to the owners again and again
const isFirstNotice = Effect.fn('Bot.isFirstNotice')(function* (chatId: number) {
    const db = yield* Db;
    const action = 'chat.unknown';
    const told = yield* db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(and(eq(auditLog.action, action), eq(auditLog.entityId, String(chatId))));

    if (!isNotEmptyArray(told)) {
        yield* db.insert(auditLog).values({ actorKind: 'bot', action, entityType: 'telegram_chat', entityId: String(chatId) });
    }

    return !isNotEmptyArray(told);
});

const tellUnknown = Effect.fn('Bot.tellUnknownGroup')(function* (chatId: number, title: string) {
    if (!(yield* isFirstNotice(chatId))) {
        return;
    }

    const db = yield* Db;
    const screenIn = (locale: Locale) => leaveScreen(locale, chatId, menuText(locale, 'groupUnknown', { title: escapeHtml(title) }));
    yield* tellOwners(screenIn);

    for (const { id } of yield* db.select({ id: community.id }).from(community)) {
        yield* tellApprover(id, screenIn);
    }
});

const tellLinked = Effect.fn('Bot.tellLinkedGroup')(function* (
    { communityId, title }: { readonly communityId: string; readonly title: string },
    update: ChatMemberUpdated
) {
    const { chat, new_chat_member: member, old_chat_member: before } = update;
    const isLost = !isPresent(member) || (before?.status === 'administrator' && member.status !== 'administrator');

    if (isLost) {
        yield* setChatSwitch({ communityId, chatId: BigInt(chat.id), actorPersonId: null }, { isPosting: false });
    }

    yield* tellApprover(communityId, locale => ({
        text: [
            ...(isLost ? [menuText(locale, isPresent(member) ? 'groupDemoted' : 'groupRemoved', { title: escapeHtml(title) })] : []),
            ...(isPresent(member) ? withRights(locale, member, title) : []),
            ...(!isLost && !isNotEmptyArray(rightsMissing(locale, member))
                ? [menuText(locale, 'groupRightsDone', { title: escapeHtml(title) })]
                : [])
        ].join('\n\n'),
        keyboard: [[{ text: menuText(locale, 'groupOpen'), callback_data: `g:s:${chat.id}` }]]
    }));
});

export const handleBotMembership = Effect.fn('Bot.handleBotMembership')(function* (update: ChatMemberUpdated) {
    const { chat, new_chat_member: member, old_chat_member: before } = update;

    if (chat.type === 'private') {
        return;
    }

    const linked = yield* findLinkedChat(BigInt(chat.id));
    const known = yield* findKnownChat(chat.id);

    if (Option.isSome(linked)) {
        yield* tellLinked(linked.value, update);
    } else if (isPresent(member) && !isPresent(before)) {
        yield* Option.match(known, {
            onNone: () => tellUnknown(chat.id, chat.title ?? ''),
            onSome: ({ communityId, chat: settings }) =>
                tellApprover(communityId, locale => {
                    const screen = askScreen(locale, settings);

                    return { ...screen, text: [screen.text, ...withRights(locale, member, settings.title)].join('\n\n') };
                })
        });
    }
});
