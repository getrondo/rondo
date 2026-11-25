import { isDefined } from '@rnw-community/shared';
import { telegramPoll } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, isNull } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { postingChatsOf } from '../community/community.repository';
import { pollChatsOf } from '../signups/poll-chats';

import type { Action } from './action.model';
import type { ActionContext } from './execute-action';

type Place = Pick<ActionContext, 'communityId' | 'group'>;

const openPollChats = Effect.fn('Core.openPollChats')(function* (sessionId: string) {
    const db = yield* Db;
    const open = yield* db.$count(telegramPoll, and(eq(telegramPoll.sessionId, sessionId), isNull(telegramPoll.closedAt)));

    return open > 0 ? (yield* pollChatsOf(sessionId)).map(chatId => `${chatId}`) : [];
});

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
        return [...noticeChats(action), ...(yield* openPollChats(action.sessionId))];
    }

    return action._tag === 'delete_session' ? yield* openPollChats(action.sessionId) : [];
});

// The groups the action writes to, none for an action that stays private
export const groupsTouched = Effect.fn('Core.groupsTouched')(function* (action: Action, context: Place) {
    const posting = yield* postingChatsOf(context.communityId);
    const chats = action._tag === 'publish_teams' ? [] : yield* chatsOf(action, context);

    return posting.filter(
        ({ chatId, title }) => chats.includes(String(chatId)) || (action._tag === 'publish_teams' && action.preview.to.includes(title))
    );
});
