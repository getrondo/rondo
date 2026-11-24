import { isDefined } from '@rnw-community/shared';
import { importedPoll, pollVote } from '@rondo/db/schema/platform.schema';
import { inArray } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { insertMany } from '../utils/insert-many.util';

import type { PollPostFact } from '../extract/fact.model';
import type { Directory } from '../interface/directory.interface';
import type { LoadContext } from '../interface/load-context.interface';

const firstPosts = (posts: readonly PollPostFact[], pollIdByMessage: ReadonlyMap<number, string>): Map<string, PollPostFact> => {
    const first = new Map<string, PollPostFact>();

    for (const post of posts.toSorted((left, right) => left.messageId - right.messageId)) {
        const pollId = pollIdByMessage.get(post.messageId);

        if (isDefined(pollId) && !first.has(pollId)) {
            first.set(pollId, post);
        }
    }

    return first;
};

export const insertVotes = Effect.fn('IngestTelegram.insertVotes')(function* (
    { transaction, communityId, plan, snapshot }: LoadContext,
    directory: Directory,
    sessionIds: readonly string[]
) {
    if (!isDefined(snapshot)) {
        return 0;
    }

    const pollSessions = (messageIdsOf: (index: number) => readonly number[]): Map<string, string> =>
        new Map(
            sessionIds.flatMap((sessionId, index) =>
                messageIdsOf(index).flatMap(messageId => {
                    const pollId = snapshot.pollIdByMessage.get(messageId);

                    return isDefined(pollId) ? [[pollId, sessionId] as const] : [];
                })
            )
        );
    const participation = pollSessions(index => plan.sessions[index]?.pollMessageIds ?? []);
    const reserve = pollSessions(index => plan.sessions[index]?.reservePollMessageIds ?? []);
    const polls = [...firstPosts(plan.facts.pollPosts, snapshot.pollIdByMessage)].map(([pollId, post]) => {
        const otherKind = post.isReserve ? ('reserve' as const) : ('other' as const);

        return {
            pollId,
            communityId,
            sessionId: participation.get(pollId) ?? reserve.get(pollId) ?? null,
            messageId: post.messageId,
            postedAt: post.postedAt,
            kind: participation.has(pollId) ? ('participation' as const) : otherKind,
            answers: post.answers
        };
    });
    const known = new Set(polls.map(({ pollId }) => pollId));
    const rows = snapshot.votes.flatMap(({ pollId, userId, choice, votedAt }) => {
        const tgUserId = BigInt(userId);

        return known.has(pollId) && directory.personIdByAccount.has(tgUserId)
            ? [{ pollId, tgUserId, sessionId: participation.get(pollId) ?? null, choice, votedAt }]
            : [];
    });

    yield* insertMany([...known], batch => transaction.delete(pollVote).where(inArray(pollVote.pollId, batch)));
    yield* insertMany([...known], batch => transaction.delete(importedPoll).where(inArray(importedPoll.pollId, batch)));
    yield* insertMany(polls, batch => transaction.insert(importedPoll).values(batch));
    yield* insertMany(rows, batch => transaction.insert(pollVote).values(batch).onConflictDoNothing());

    return rows.length;
});
