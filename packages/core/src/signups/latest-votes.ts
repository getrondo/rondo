import { telegramAccount } from '@rondo/db/schema/identity.schema';
import { pollVote } from '@rondo/db/schema/platform.schema';
import { desc, eq } from 'drizzle-orm';

import type { Database } from '@rondo/db/service/db.service';

export const latestVotes = (db: Database) =>
    db
        .selectDistinctOn([pollVote.sessionId, telegramAccount.personId], {
            sessionId: pollVote.sessionId,
            personId: telegramAccount.personId,
            choice: pollVote.choice,
            votedAt: pollVote.votedAt
        })
        .from(pollVote)
        .innerJoin(telegramAccount, eq(telegramAccount.tgUserId, pollVote.tgUserId))
        .orderBy(pollVote.sessionId, telegramAccount.personId, desc(pollVote.votedAt))
        .as('latest_vote');
