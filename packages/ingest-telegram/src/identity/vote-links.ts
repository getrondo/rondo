import { isDefined } from '@rnw-community/shared';
import { personAlias, telegramAccount } from '@rondo/db/schema/identity.schema';
import { pollVote } from '@rondo/db/schema/platform.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { assignAlias, guestPersonOf } from './assign-alias';
import { isCertain, rankVoteMatches, type RankedMatch, type VoteEvidence } from './match-votes';

const addTo = <Key>(groups: Map<Key, Set<string>>, key: Key, value: string): void => {
    const group = groups.get(key) ?? new Set();
    group.add(value);
    groups.set(key, group);
};

const loadEvidence = Effect.fn('IngestTelegram.loadEvidence')(function* (communityId: string) {
    const db = yield* Db;
    const votes = yield* db
        .selectDistinctOn([pollVote.sessionId, pollVote.tgUserId], {
            sessionId: pollVote.sessionId,
            tgUserId: pollVote.tgUserId,
            personId: telegramAccount.personId,
            choice: pollVote.choice
        })
        .from(pollVote)
        .innerJoin(session, eq(session.id, pollVote.sessionId))
        .innerJoin(telegramAccount, eq(telegramAccount.tgUserId, pollVote.tgUserId))
        .where(eq(session.communityId, communityId))
        .orderBy(pollVote.sessionId, pollVote.tgUserId, desc(pollVote.votedAt));
    const entries = yield* db
        .select({
            sessionId: lineupEntry.sessionId,
            aliasId: lineupEntry.aliasId,
            personId: lineupEntry.personId,
            resolvedBy: lineupEntry.resolvedBy,
            kind: personAlias.kind
        })
        .from(lineupEntry)
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .leftJoin(personAlias, eq(personAlias.id, lineupEntry.aliasId))
        .where(and(eq(session.communityId, communityId), isNotNull(lineupEntry.personId)));
    const withLineup = new Set(entries.map(entry => entry.sessionId));
    const withVoters = new Set(votes.map(vote => vote.sessionId));
    const yesGamesByAccount = new Map<bigint, Set<string>>();
    const gamesByAlias = new Map<string, Set<string>>();
    const personIdByAccount = new Map(
        votes.flatMap(({ tgUserId, personId }) => (isDefined(personId) ? [[tgUserId, personId] as const] : []))
    );

    for (const { choice, sessionId, tgUserId } of votes) {
        if (choice === 'yes' && isDefined(sessionId) && withLineup.has(sessionId)) {
            addTo(yesGamesByAccount, tgUserId, sessionId);
        }
    }

    for (const { aliasId, sessionId, resolvedBy, kind } of entries) {
        if (isDefined(aliasId) && kind !== 'placeholder' && resolvedBy !== 'manual' && withVoters.has(sessionId)) {
            addTo(gamesByAlias, aliasId, sessionId);
        }
    }

    return {
        personIdByAccount,
        yesGamesByAccount,
        gamesByAlias,
        otherAliasGamesByPerson: (personId, aliasId) =>
            new Set(entries.filter(entry => entry.personId === personId && entry.aliasId !== aliasId).map(entry => entry.sessionId))
    } satisfies VoteEvidence;
});

const openResolutions = ['unresolved', 'suggested'] as const;

export const rankedLinks = Effect.fn('IngestTelegram.rankedLinks')(function* (communityId: string) {
    const db = yield* Db;
    const open = yield* db
        .select()
        .from(personAlias)
        .where(
            and(eq(personAlias.communityId, communityId), inArray(personAlias.resolution, openResolutions), ne(personAlias.kind, 'self'))
        );
    const aliasById = new Map(open.map(alias => [alias.id, alias]));

    const evidence = yield* loadEvidence(communityId);

    return rankVoteMatches(evidence).flatMap(match => {
        const alias = aliasById.get(match.aliasId);

        return isDefined(alias) ? [{ ...match, alias }] : [];
    });
});

export const releaseVoteLinks = Effect.fn('IngestTelegram.releaseVoteLinks')(function* (communityId: string) {
    const db = yield* Db;
    const linked = yield* db
        .select()
        .from(personAlias)
        .where(and(eq(personAlias.communityId, communityId), eq(personAlias.resolution, 'vote')));

    for (const alias of linked) {
        const personId = yield* guestPersonOf(alias);
        yield* assignAlias({ alias, personId, resolution: 'unresolved', resolvedBy: 'guest' });
    }
});

const firstPerPerson = <Match extends RankedMatch>(matches: readonly Match[]): Match[] => [
    ...new Map(matches.toSorted((left, right) => left.score - right.score).map(match => [match.personId, match])).values()
];

export const linkByVotes = Effect.fn('IngestTelegram.linkByVotes')(function* (communityId: string) {
    const db = yield* Db;
    const confirmed = yield* db
        .select({ personId: personAlias.personId })
        .from(personAlias)
        .where(and(eq(personAlias.communityId, communityId), eq(personAlias.resolution, 'confirmed')));
    const taken = new Set(confirmed.map(alias => alias.personId));
    const certain = firstPerPerson((yield* rankedLinks(communityId)).filter(match => isCertain(match) && !taken.has(match.personId)));

    for (const { alias, personId } of certain) {
        yield* assignAlias({ alias, personId, resolution: 'vote', resolvedBy: 'vote' });
    }

    return certain.length;
});
