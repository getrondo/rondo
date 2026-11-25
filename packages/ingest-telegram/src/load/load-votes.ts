import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { importedPoll, pollVote, telegramPoll } from '@rondo/db/schema/platform.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { and, eq, inArray, ne } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { ForeignPollError } from '../error/foreign-poll.error';
import { TooManyRemovedGamesError } from '../error/too-many-removed-games.error';
import { sourceOf } from '../extract/post-id';
import { insertMany } from '../utils/insert-many.util';

import { maxRemovedShare } from './delete-stale-sessions';

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
    { transaction, communityId, config, plan, snapshot, allowRemoval }: LoadContext,
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

        return Object.assign(sourceOf(config.otherChats, post.messageId), {
            pollId,
            communityId,
            sessionId: participation.get(pollId) ?? reserve.get(pollId) ?? null,
            postedAt: post.postedAt,
            kind: participation.has(pollId) ? ('participation' as const) : otherKind,
            answers: post.answers
        });
    });
    const known = new Set(polls.map(({ pollId }) => pollId));
    const rows = snapshot.votes.flatMap(({ pollId, userId, choice, votedAt }) => {
        const tgUserId = BigInt(userId);

        return known.has(pollId) && directory.personIdByAccount.has(tgUserId)
            ? [{ pollId, tgUserId, sessionId: participation.get(pollId) ?? null, choice, votedAt }]
            : [];
    });

    const foreign = yield* transaction
        .selectDistinct({ pollId: pollVote.pollId })
        .from(pollVote)
        .innerJoin(session, eq(session.id, pollVote.sessionId))
        .where(and(inArray(pollVote.pollId, [...known]), ne(session.communityId, communityId)))
        .union(
            transaction
                .select({ pollId: importedPoll.pollId })
                .from(importedPoll)
                .where(and(inArray(importedPoll.pollId, [...known]), ne(importedPoll.communityId, communityId)))
        )
        .union(
            transaction
                .select({ pollId: telegramPoll.pollId })
                .from(telegramPoll)
                .innerJoin(session, eq(session.id, telegramPoll.sessionId))
                .where(and(inArray(telegramPoll.pollId, [...known]), ne(session.communityId, communityId)))
        );

    if (isNotEmptyArray(foreign)) {
        return yield* ForeignPollError.make({ pollIds: foreign.map(({ pollId }) => pollId).toSorted() });
    }

    const stored = yield* transaction.$count(pollVote, inArray(pollVote.pollId, [...known]));

    if (allowRemoval !== true && rows.length < stored * (1 - maxRemovedShare)) {
        return yield* TooManyRemovedGamesError.make({ dates: [], imported: stored });
    }

    yield* insertMany([...known], batch => transaction.delete(pollVote).where(inArray(pollVote.pollId, batch)));
    yield* insertMany([...known], batch =>
        transaction.delete(importedPoll).where(and(inArray(importedPoll.pollId, batch), eq(importedPoll.communityId, communityId)))
    );
    yield* insertMany(polls, batch => transaction.insert(importedPoll).values(batch));
    yield* insertMany(rows, batch => transaction.insert(pollVote).values(batch).onConflictDoNothing());

    return rows.length;
});
