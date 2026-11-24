import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { personAlias } from '@rondo/db/schema/identity.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { syncSessionRoster } from '../roster/sync-session-roster';

import { assignAlias } from './assign-alias';
import { loadEvidence, withLinks, type LinkEvidence } from './load-evidence';
import { isCertainSet, judge, matchSegments, matchSet, splitByGaps, type VoteMatch } from './match-votes';
import { refreshNames } from './refresh-names';

const openAliases = Effect.fn('IngestTelegram.openAliases')(function* (communityId: string) {
    const db = yield* Db;
    const open = yield* db
        .select()
        .from(personAlias)
        .where(and(eq(personAlias.communityId, communityId), inArray(personAlias.resolution, ['unresolved', 'suggested'])));

    return new Map(open.map(alias => [alias.id, alias]));
});

export const rankedLinks = Effect.fn('IngestTelegram.rankedLinks')(function* (communityId: string) {
    const evidence = yield* loadEvidence(communityId);
    const open = yield* openAliases(communityId);

    return [...evidence.timelines]
        .flatMap(([aliasId, timeline]) => {
            const alias = open.get(aliasId);

            return judge(evidence, aliasId, timeline).pipe(Option.toArray, matches =>
                isDefined(alias) ? matches.map(match => Object.assign(match, { alias })) : []
            );
        })
        .toSorted((left, right) => right.score - left.score);
});

export const releaseVoteLinks = Effect.fn('IngestTelegram.releaseVoteLinks')(function* (communityId: string) {
    const db = yield* Db;
    const inCommunity = sql`select id from identity.person_alias where community_id = ${communityId}::uuid`;

    yield* db
        .update(personAlias)
        .set({ personId: personAlias.guestPersonId, resolution: 'unresolved' })
        .where(and(eq(personAlias.communityId, communityId), eq(personAlias.resolution, 'vote')));
    yield* db
        .update(personAlias)
        .set({ kind: 'nickname', personId: personAlias.guestPersonId })
        .where(and(eq(personAlias.communityId, communityId), eq(personAlias.kind, 'placeholder')));
    const linked = yield* db
        .select({ personId: lineupEntry.personId, sessionId: lineupEntry.sessionId })
        .from(lineupEntry)
        .where(and(eq(lineupEntry.resolvedBy, 'vote'), sql`${lineupEntry.aliasId} in (${inCommunity})`));
    yield* db
        .update(lineupEntry)
        .set({
            resolvedBy: 'guest',
            personId: sql`(select alias.person_id from identity.person_alias alias where alias.id = ${lineupEntry.aliasId})`
        })
        .where(and(eq(lineupEntry.resolvedBy, 'vote'), sql`${lineupEntry.aliasId} in (${inCommunity})`));

    yield* syncSessionRoster([...new Set(linked.map(({ sessionId }) => sessionId))]);

    return linked.flatMap(({ personId }) => (isDefined(personId) ? [personId] : []));
});

const assignEntries = Effect.fn('IngestTelegram.assignEntries')(function* (entryIds: readonly string[], personId: string) {
    const db = yield* Db;

    if (isNotEmptyArray(entryIds)) {
        yield* db
            .update(lineupEntry)
            .set({ personId, resolvedBy: 'vote' })
            .where(inArray(lineupEntry.id, [...entryIds]));
    }
});

const firstAliasPerPerson = (matches: readonly VoteMatch[]): VoteMatch[] => {
    const aliasByPerson = new Map<string, string>();

    for (const { personId, aliasId } of matches.toSorted((left, right) => right.shared - left.shared)) {
        aliasByPerson.set(personId, aliasByPerson.get(personId) ?? aliasId);
    }

    return matches.filter(({ personId, aliasId }) => aliasByPerson.get(personId) === aliasId);
};

const entriesIn = (evidence: LinkEvidence, aliasId: string, sessionIds: readonly string[]) => {
    const sessions = new Set(sessionIds);

    return evidence.entries.filter(entry => entry.aliasId === aliasId && entry.resolvedBy !== 'manual' && sessions.has(entry.sessionId));
};

const linkNicknames = Effect.fn('IngestTelegram.linkNicknames')(function* (communityId: string, evidence: LinkEvidence) {
    const db = yield* Db;
    const open = yield* openAliases(communityId);
    const confirmed = yield* db
        .select({ personId: personAlias.personId })
        .from(personAlias)
        .where(and(eq(personAlias.communityId, communityId), eq(personAlias.resolution, 'confirmed')));
    const taken = new Set(confirmed.map(({ personId }) => personId));
    const results = [...evidence.timelines.keys()]
        .filter(aliasId => open.has(aliasId))
        .map(aliasId => Object.assign(matchSegments(evidence, aliasId), { aliasId }));
    const allowed = new Set(firstAliasPerPerson(results.flatMap(({ matches }) => matches).filter(({ personId }) => !taken.has(personId))));
    const touched: string[] = [];
    const linked = new Map<string, string>();
    let aliases = 0;
    let segmentLinks = 0;

    for (const { aliasId, segments, matches } of results) {
        const kept = matches.filter(match => allowed.has(match));
        const alias = open.get(aliasId);
        const [first] = kept;
        const agreed = kept.length === segments && kept.every(({ personId }) => personId === first?.personId);

        for (const { personId, sessionIds } of kept) {
            const entries = entriesIn(evidence, aliasId, sessionIds).filter(entry => isDefined(entry.personId));

            for (const { id } of entries) {
                linked.set(id, personId);
            }

            if (!agreed) {
                segmentLinks += 1;
                touched.push(...entries.map(({ sessionId }) => sessionId));
                yield* assignEntries(
                    entries.map(({ id }) => id),
                    personId
                );
            }
        }

        if (isDefined(alias) && isDefined(first) && agreed) {
            aliases += 1;
            yield* assignAlias({ alias, personId: first.personId, resolution: 'vote', resolvedBy: 'vote' });
        }
    }

    yield* syncSessionRoster([...new Set(touched)]);
    yield* refreshNames([...allowed].map(({ personId }) => personId));

    return { aliases, segments: segmentLinks, linked };
});

const gameAssignments = (
    evidence: LinkEvidence,
    aliasId: string,
    personIds: readonly string[],
    segment: readonly { sessionId: string }[]
) =>
    segment.flatMap(({ sessionId }) => {
        const yes = evidence.squads.find(squad => squad.sessionId === sessionId)?.yes;
        const playing = personIds.filter(personId => yes?.has(personId) === true);
        const entries = evidence.entries.filter(entry => entry.aliasId === aliasId && entry.sessionId === sessionId);
        const isOpen = entries.every(({ resolvedBy }) => resolvedBy !== 'manual');

        return isOpen && playing.length === entries.length
            ? entries.map((entry, index) => ({ entry, personId: playing[index] ?? '' }))
            : [];
    });

const linkSharedNickname = Effect.fn('IngestTelegram.linkSharedNickname')(function* (evidence: LinkEvidence, aliasId: string) {
    const assignments = splitByGaps(evidence.sharedTimelines.get(aliasId) ?? []).flatMap(segment => {
        const isPossible = (personId: string): boolean => {
            const otherGames = evidence.gamesUnderOtherName(personId, aliasId);

            return segment.every(({ sessionId }) => !otherGames.has(sessionId));
        };

        return matchSet(evidence.squads, segment, isPossible).pipe(
            Option.filter(found => isCertainSet(found)),
            Option.match({ onNone: () => [], onSome: ({ personIds }) => gameAssignments(evidence, aliasId, personIds, segment) })
        );
    });

    for (const { entry, personId } of assignments) {
        yield* assignEntries([entry.id], personId);
    }

    yield* syncSessionRoster([...new Set(assignments.map(({ entry }) => entry.sessionId))]);

    return new Map(assignments.map(({ entry, personId }) => [entry.id, personId]));
});

export const linkByVotes = Effect.fn('IngestTelegram.linkByVotes')(function* (communityId: string) {
    const loaded = yield* loadEvidence(communityId);
    const { aliases, segments, linked } = yield* linkNicknames(communityId, loaded);
    const open = yield* openAliases(communityId);
    const shared = [...open.values()]
        .filter(({ kind }) => kind === 'placeholder')
        .toSorted((left, right) => right.occurrences - left.occurrences || left.aliasNorm.localeCompare(right.aliasNorm));
    let evidence = withLinks(loaded, linked);
    let sharedEntries = 0;

    for (const { id } of shared) {
        const assigned = yield* linkSharedNickname(evidence, id);
        evidence = withLinks(evidence, assigned);
        sharedEntries += assigned.size;
    }

    return { aliases, segments, sharedEntries };
});
