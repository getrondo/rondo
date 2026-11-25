import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { setChatSwitch } from '@rondo/core/community/chat-links';
import { findLinkedChat } from '@rondo/core/community/community.repository';
import { findKnownChat, isUpgrading } from '@rondo/core/community/group-settings';
import { addMillis } from '@rondo/core/utils/add-millis.util';
import { Db } from '@rondo/db/service/db.service';
import { escapeHtml } from '@rondo/telegram/format/html';
import { sql } from 'drizzle-orm';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { askScreen, leaveScreen } from '../menu/groups/groups.screen';
import { tellApprover, tellOwners } from '../menu/groups/tell';
import { menuText } from '../menu/menu-text';

import { presenceOf } from './chat-member.handler';

import type { Locale } from '@rondo/core/i18n/locale';
import type { ChatMember, ChatMemberUpdated } from '@rondo/telegram/webhook/telegram-update.model';

const dayMs = 24 * 60 * 60_000;

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

const noticesPerDay = 3;

// One notice per chat and a few a day, or a stranger could make the bot write to the owners again and again
const claimUnknown = Effect.fn('Bot.claimUnknownGroup')(function* (chatId: number) {
    const db = yield* Db;
    const at = yield* DateTime.nowAsDate;

    return yield* db.transaction(() =>
        Effect.gen(function* () {
            yield* db.execute(sql`select pg_advisory_xact_lock(hashtext('chat.unknown'))`);
            const inserted = yield* db.execute(sql`
                insert into audit.log (id, actor_kind, action, entity_type, entity_id, at)
                select gen_random_uuid(), 'bot', 'chat.unknown', 'telegram_chat', ${String(chatId)}, ${at}
                where not exists (select 1 from audit.log where action = 'chat.unknown' and entity_id = ${String(chatId)})
                  and (select count(*) from audit.log where action = 'chat.unknown' and at > ${addMillis(at, -dayMs)}) < ${noticesPerDay}
                returning id`);

            return isNotEmptyArray(inserted.rows);
        })
    );
});

const tellUnknown = Effect.fn('Bot.tellUnknownGroup')(function* (chatId: number, title: string) {
    if (!(yield* isUpgrading(title)) && (yield* claimUnknown(chatId))) {
        yield* tellOwners(locale => leaveScreen(locale, chatId, menuText(locale, 'groupUnknown', { title: escapeHtml(title) })));
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

// A group that became a supergroup keeps its settings, and one that was never linked is asked about again
export const tellMoved = Effect.fn('Bot.tellMoved')(function* (chatId: number) {
    const linked = yield* findLinkedChat(BigInt(chatId));
    const known = yield* findKnownChat(chatId);

    if (Option.isSome(known)) {
        yield* tellApprover(known.value.communityId, locale =>
            Option.match(linked, {
                onNone: () => askScreen(locale, known.value.chat, known.value.chat.title),
                onSome: ({ title }) => ({
                    text: menuText(locale, 'groupMoved', { title: escapeHtml(title) }),
                    keyboard: [[{ text: menuText(locale, 'groupOpen'), callback_data: `g:s:${chatId}` }]]
                })
            })
        );
    }
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
                    const screen = askScreen(locale, settings, chat.title ?? settings.title);

                    return { ...screen, text: [screen.text, ...withRights(locale, member, chat.title ?? settings.title)].join('\n\n') };
                })
        });
    }
});
