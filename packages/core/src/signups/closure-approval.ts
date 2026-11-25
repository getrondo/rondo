import { isDefined, isEmptyArray, isNotEmptyArray } from '@rnw-community/shared';
import { telegramChat } from '@rondo/db/schema/org.schema';
import { pendingAction } from '@rondo/db/schema/platform.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { approverOf } from '../community/group-settings';

import { pollChatsOf } from './poll-chats';

// A cancelled game needs the ✅ of its cancellation. After a played one the ✅ of the poll counts, in every linked group it is in
export const closureApproval = Effect.fn('Core.closureApproval')(function* (sessionId: string) {
    const db = yield* Db;
    const [game] = yield* db.select().from(session).where(eq(session.id, sessionId));
    const approver = isDefined(game) ? yield* approverOf(game.communityId) : Option.none();

    if (!isDefined(game) || Option.isNone(approver)) {
        return null;
    }

    const { tgUserId } = approver.value;
    const decided = yield* db
        .select({ kind: pendingAction.kind, chatId: sql<string | null>`${pendingAction.payload} ->> 'chatId'` })
        .from(pendingAction)
        .where(
            and(
                eq(pendingAction.status, 'confirmed'),
                sql`coalesce(${pendingAction.approverTgUserId}, ${pendingAction.requestedByTgUserId}) = ${tgUserId}`,
                sql`coalesce(${pendingAction.payload} ->> 'sessionId', ${pendingAction.result} ->> 'sessionId') = ${sessionId}`
            )
        );
    const chatIds = yield* pollChatsOf(sessionId);
    const linked = isNotEmptyArray(chatIds) ? yield* db.select().from(telegramChat).where(inArray(telegramChat.chatId, chatIds)) : [];
    const polls = decided.filter(({ kind }) => ['create_session', 'announce_session', 'forward_poll'].includes(kind));
    const uncovered = linked.filter(chat => !polls.some(({ chatId }) => chatId === String(chat.chatId)));
    const isAllowed =
        game.status === 'cancelled'
            ? decided.some(({ kind }) => kind === 'cancel_session')
            : game.status === 'played' && isEmptyArray(uncovered);

    return isAllowed ? ({ _tag: 'approver', tgUserId } as const) : null;
});
