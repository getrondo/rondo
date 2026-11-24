import { person } from '@rondo/db/schema/identity.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { latestVotes } from './latest-votes';

export const signedUpByVotes = Effect.fn('Core.signedUpByVotes')(function* (sessionId: string) {
    const db = yield* Db;
    const vote = latestVotes(db);

    return yield* db
        .select({ personId: person.id, displayName: person.displayName, votedAt: vote.votedAt })
        .from(vote)
        .innerJoin(person, eq(person.id, vote.personId))
        .where(and(eq(vote.sessionId, sessionId), eq(vote.choice, 'yes')))
        .orderBy(asc(vote.votedAt));
});
