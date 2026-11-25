import { isDefined } from '@rnw-community/shared';
import { telegramPoll } from '@rondo/db/schema/platform.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, isNull } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { postingChatsOf } from '../community/community.repository';

import type { Action } from './action.model';
import type { ActionContext } from './execute-action';

const openPollChats = Effect.fn('Core.openPollChats')(function* (sessionId: string) {
    const db = yield* Db;
    const polls = yield* db
        .select({ chatId: telegramPoll.chatId })
        .from(telegramPoll)
        .where(and(eq(telegramPoll.sessionId, sessionId), isNull(telegramPoll.closedAt)));

    return polls.map(({ chatId }) => String(chatId));
});

const noticeChats = (action: Extract<Action, { _tag: 'update_session' | 'cancel_session' }>): readonly string[] =>
    action.notify ? (action.preview?.targets.map(({ chatId }) => chatId) ?? []) : [];

const pollChat = (chatId: string | undefined, { group }: ActionContext): readonly string[] =>
    isDefined(chatId) ? [chatId] : Option.toArray(group).map(target => String(target.chatId));

// Every group the action writes to, also one whose poll it only closes
const chatsOf = Effect.fn('Core.chatsOfAction')(function* (action: Action, context: ActionContext) {
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

// Titles of the groups the action writes to, none for an action that stays private
export const groupsTouched = Effect.fn('Core.groupsTouched')(function* (action: Action, context: ActionContext) {
    if (action._tag === 'publish_teams') {
        return action.preview.to.filter(title => isDefined(title));
    }

    const chats = yield* chatsOf(action, context);
    const posting = yield* postingChatsOf(context.communityId);

    return posting.filter(({ chatId }) => chats.includes(String(chatId))).map(({ title }) => title);
});
