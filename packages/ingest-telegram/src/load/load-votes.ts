import { isDefined } from '@rnw-community/shared';
import { pollVote } from '@rondo/db/schema/platform.schema';
import { inArray } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { insertMany } from '../utils/insert-many.util';

import type { Directory } from '../interface/directory.interface';
import type { LoadContext } from '../interface/load-context.interface';

export const insertVotes = Effect.fn('IngestTelegram.insertVotes')(function* (
    { transaction, plan, snapshot }: LoadContext,
    directory: Directory,
    sessionIds: readonly string[]
) {
    if (!isDefined(snapshot)) {
        return 0;
    }

    const sessionIdByPoll = new Map(
        plan.sessions.flatMap((planned, index) =>
            planned.pollMessageIds.flatMap(messageId => {
                const pollId = snapshot.pollIdByMessage.get(messageId);

                return isDefined(pollId) ? [[pollId, sessionIds[index] ?? ''] as const] : [];
            })
        )
    );
    const rows = snapshot.votes.flatMap(({ pollId, userId, choice, votedAt }) => {
        const sessionId = sessionIdByPoll.get(pollId);
        const tgUserId = BigInt(userId);

        return isDefined(sessionId) && directory.personIdByAccount.has(tgUserId) ? [{ pollId, tgUserId, sessionId, choice, votedAt }] : [];
    });

    yield* insertMany([...sessionIdByPoll.keys()], batch => transaction.delete(pollVote).where(inArray(pollVote.pollId, batch)));
    yield* insertMany(rows, batch => transaction.insert(pollVote).values(batch).onConflictDoNothing());

    return rows.length;
});
