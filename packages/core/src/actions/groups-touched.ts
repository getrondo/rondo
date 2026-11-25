import { isDefined } from '@rnw-community/shared';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { linkedChatsOf, postingChatsOf } from '../community/community.repository';
import { closureOf } from '../signups/poll-chats';

import type { Action } from './action.model';
import type { ActionContext } from './execute-action';

type Place = Pick<ActionContext, 'communityId' | 'group'>;

const noticeChats = (action: Extract<Action, { _tag: 'update_session' | 'cancel_session' }>): readonly string[] =>
    action.notify ? (action.preview?.targets.map(({ chatId }) => chatId) ?? []) : [];

const pollChat = (chatId: string | undefined, { group }: Place): readonly string[] =>
    isDefined(chatId) ? [chatId] : Option.toArray(group).map(target => String(target.chatId));

// Every group the action writes to, also one whose poll it only closes
const chatsOf = Effect.fn('Core.chatsOfAction')(function* (action: Action, context: Place) {
    if (action._tag === 'create_session') {
        return action.announce ? pollChat(action.chatId, context) : [];
    }

    if (action._tag === 'announce_session' || action._tag === 'forward_poll') {
        return pollChat(action.chatId, context);
    }

    if (action._tag === 'update_session') {
        return noticeChats(action);
    }

    if (action._tag === 'cancel_session') {
        return [...noticeChats(action), ...(yield* closureOf(action.sessionId)).chatIds];
    }

    if (action._tag === 'publish_teams') {
        return action.preview.chatIds ?? [];
    }

    return action._tag === 'delete_session' || action._tag === 'close_poll' ? (yield* closureOf(action.sessionId)).chatIds : [];
});

// The groups the action writes to, none for an action that stays private
export const groupsTouched = Effect.fn('Core.groupsTouched')(function* (action: Action, context: Place) {
    const groups = yield* (action._tag === 'close_poll' ? linkedChatsOf : postingChatsOf)(context.communityId);
    const chats = yield* chatsOf(action, context);

    return groups.filter(({ chatId }) => chats.includes(String(chatId)));
});
