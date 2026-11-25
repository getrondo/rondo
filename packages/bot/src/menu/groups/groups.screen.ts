import { isNotEmptyArray } from '@rnw-community/shared';
import { linkedChatsOf } from '@rondo/core/community/community.repository';
import { knownChatsOf, type KnownChat } from '@rondo/core/community/group-settings';
import { escapeHtml } from '@rondo/telegram/format/html';
import * as Effect from 'effect/Effect';

import { buttonBudget } from '../../utils/button-budget.util';
import { fitLabel } from '../../utils/fit-label.util';
import { menuText } from '../menu-text';

import type { MenuUser, Screen } from '../screen.interface';
import type { Locale } from '@rondo/core/i18n/locale';

type LinkedChat = Effect.Success<ReturnType<typeof linkedChatsOf>>[number];

export const askScreen = (locale: Locale, { chatId, title: known, purpose }: KnownChat, title: string): Screen => ({
    text: [
        menuText(locale, 'groupAsk', {
            title: escapeHtml(title),
            purpose: menuText(locale, purpose === 'main' ? 'groupMain' : 'groupOther')
        }),
        ...(title === known ? [] : [menuText(locale, 'groupOtherTitle', { known: escapeHtml(known) })])
    ].join('\n\n'),
    keyboard: [
        [{ text: menuText(locale, 'groupYes'), callback_data: `g:y:${chatId}` }],
        [{ text: menuText(locale, 'groupTopic'), callback_data: `g:t:${chatId}` }],
        [{ text: menuText(locale, 'groupNo'), callback_data: `g:n:${chatId}` }]
    ]
});

export const leaveScreen = (locale: Locale, chatId: number, text: string): Screen => ({
    text,
    keyboard: [[{ text: menuText(locale, 'groupLeave'), callback_data: `g:l:${chatId}` }]]
});

export const groupScreen = (locale: Locale, chat: LinkedChat, header: string): Screen => {
    const button = (text: string, op: string) => ({ text, callback_data: `g:${op}:${chat.chatId}` });
    const example = menuText(locale, 'groupMentionExample');
    const mention = chat.isMentioning
        ? button(menuText(locale, 'groupMentionOff'), 'm:0')
        : button(menuText(locale, 'groupMentionOn'), 'm:1');

    return {
        text: [
            header,
            `👥 <b>${escapeHtml(chat.title)}</b>`,
            menuText(locale, chat.isPosting ? 'groupModeGroup' : 'groupModeMe'),
            ...(chat.isPosting ? ['', example] : [])
        ]
            .join('\n')
            .trim(),
        keyboard: [
            [chat.isPosting ? button(menuText(locale, 'groupToMe'), 'p:0') : button(menuText(locale, 'groupToGroup'), 'p:1')],
            ...(chat.isPosting ? [[mention]] : []),
            [button(menuText(locale, 'groupTopic'), 't')],
            [button(menuText(locale, 'groupUnlink'), 'u')],
            [{ text: menuText(locale, 'home_'), callback_data: 'm:h' }]
        ]
    };
};

export const groupsScreen = Effect.fn('Bot.groupsScreen')(function* (user: MenuUser) {
    const chats = yield* linkedChatsOf(user.communityId);
    const known = yield* knownChatsOf(user.communityId);
    const waiting = known.filter(({ chatId }) => !chats.some(chat => chat.chatId === BigInt(chatId)));

    return {
        text: menuText(user.locale, isNotEmptyArray([...chats, ...waiting]) ? 'groupsTitle' : 'groupsNone'),
        keyboard: [
            ...chats.map(chat => [{ text: fitLabel(chat.title, buttonBudget(1)), callback_data: `g:s:${chat.chatId}` }]),
            ...waiting.map(chat => [{ text: fitLabel(`➕ ${chat.title}`, buttonBudget(1)), callback_data: `g:q:${chat.chatId}` }]),
            [{ text: menuText(user.locale, 'home_'), callback_data: 'm:h' }]
        ]
    } satisfies Screen;
});
