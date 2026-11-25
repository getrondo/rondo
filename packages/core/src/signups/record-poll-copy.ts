import { isDefined } from '@rnw-community/shared';
import { messageRef, telegramPoll } from '@rondo/db/schema/platform.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

export const recordPollCopy = Effect.fn('Core.recordPollCopy')(function* (input: {
    readonly communityId: string;
    readonly pollId: string;
    readonly chatId: bigint;
    readonly messageId: number;
}) {
    const db = yield* Db;
    const [poll] = yield* db
        .select({ sessionId: telegramPoll.sessionId, communityId: session.communityId })
        .from(telegramPoll)
        .innerJoin(session, eq(session.id, telegramPoll.sessionId))
        .where(eq(telegramPoll.pollId, input.pollId));

    if (!isDefined(poll)) {
        return false;
    }

    if (poll.communityId === input.communityId) {
        yield* db
            .insert(messageRef)
            .values({ chatId: input.chatId, messageId: input.messageId, purpose: 'poll', entityType: 'session', entityId: poll.sessionId })
            .onConflictDoNothing();
    }

    return true;
});
