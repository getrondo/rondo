import { isDefined } from '@rnw-community/shared';
import { pendingAction } from '@rondo/db/schema/platform.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, desc, eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

import { ClosesSchema, type Closes } from '../actions/action.model';
import { approverOf } from '../community/group-settings';

import { openPollOf } from './poll-chats';

const decodeCloses = Schema.decodeUnknownOption(Schema.Struct({ closes: ClosesSchema }));

// A cancelled game needs the ✅ of its cancellation. After a played one the ✅ of the poll and its forwards counts
export const closureApproval = Effect.fn('Core.closureApproval')(function* (sessionId: string) {
    const db = yield* Db;
    const [game] = yield* db.select().from(session).where(eq(session.id, sessionId));
    const approver = isDefined(game) ? yield* approverOf(game.communityId) : Option.none();
    const poll = yield* openPollOf(sessionId);

    if (!isDefined(game) || Option.isNone(approver) || Option.isNone(poll)) {
        return null;
    }

    const { tgUserId } = approver.value;
    const { pollId } = poll.value;
    const decided = yield* db
        .select({
            kind: pendingAction.kind,
            payload: pendingAction.payload,
            chatId: sql<string | null>`${pendingAction.payload} ->> 'chatId'`,
            pollId: sql<string | null>`${pendingAction.result} ->> 'pollId'`
        })
        .from(pendingAction)
        .where(
            and(
                eq(pendingAction.status, 'confirmed'),
                sql`coalesce(${pendingAction.approverTgUserId}, ${pendingAction.requestedByTgUserId}) = ${tgUserId}`,
                sql`coalesce(${pendingAction.payload} ->> 'sessionId', ${pendingAction.result} ->> 'sessionId') = ${sessionId}`
            )
        )
        .orderBy(desc(pendingAction.decidedAt));
    const cancelled = decodeCloses(decided.find(({ kind }) => kind === 'cancel_session')?.payload);
    const posted: Closes = {
        pollIds: [pollId],
        chatIds: decided.flatMap(entry => (entry.pollId === pollId && isDefined(entry.chatId) ? [entry.chatId] : []))
    };
    const closes = game.status === 'cancelled' ? Option.getOrNull(cancelled)?.closes : posted;

    return { _tag: 'approver', tgUserId, closes } as const;
});
