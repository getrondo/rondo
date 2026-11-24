import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { personAlias } from '@rondo/db/schema/identity.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { syncSessionRoster } from '../roster/sync-session-roster';

import { assignAlias } from './assign-alias';
import { loadDecisions, type LinkDecisions } from './load-decisions';
import { loadEvidence, withLinks, type EvidenceEntry, type LinkEvidence } from './load-evidence';
import { isCertainSet, matchSet } from './match-set';
import { indexVotes, matchSegments, splitByGaps, type VoteMatch } from './match-votes';
import { refreshNames } from './refresh-names';
import { suggestLinks } from './suggest-links';

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
    const periods = new Map<string, { first: string; last: string }>();

    for (const { personId, resolvedBy, date } of evidence.entries) {
        if (isDefined(personId) && resolvedBy !== 'guest') {
            periods.set(personId, { first: periods.get(personId)?.first ?? date, last: date });
        }
    }

    const unlinked = new Map([...evidence.timelines].filter(([aliasId]) => open.has(aliasId)));

    return suggestLinks({ ...evidence, timelines: unlinked }, periods).flatMap(suggestion => {
        const alias = open.get(suggestion.aliasId);

        return isDefined(alias) ? [Object.assign(suggestion, { alias })] : [];
    });
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
    const sharedByName = new Map<string, number>();

    for (const { personId, aliasId, shared } of matches) {
        sharedByName.set(`${personId}|${aliasId}`, (sharedByName.get(`${personId}|${aliasId}`) ?? 0) + shared);
    }

    const aliasByPerson = new Map<string, string>();
    const sharedOf = ({ personId, aliasId }: VoteMatch): number => sharedByName.get(`${personId}|${aliasId}`) ?? 0;

    for (const match of matches.toSorted((left, right) => sharedOf(right) - sharedOf(left))) {
        aliasByPerson.set(match.personId, aliasByPerson.get(match.personId) ?? match.aliasId);
    }

    return matches.filter(({ personId, aliasId }) => aliasByPerson.get(personId) === aliasId);
};

const isOpen = ({ resolvedBy }: EvidenceEntry): boolean => resolvedBy !== 'manual' && resolvedBy !== 'alias';

const entriesIn = (evidence: LinkEvidence, aliasId: string, sessionIds: readonly string[]) => {
    const sessions = new Set(sessionIds);

    return evidence.entries.filter(entry => entry.aliasId === aliasId && isOpen(entry) && sessions.has(entry.sessionId));
};

const linkNicknames = Effect.fn('IngestTelegram.linkNicknames')(function* (
    communityId: string,
    evidence: LinkEvidence,
    decisions: LinkDecisions
) {
    const db = yield* Db;
    const open = yield* openAliases(communityId);
    const confirmed = yield* db
        .select({ personId: personAlias.personId })
        .from(personAlias)
        .where(and(eq(personAlias.communityId, communityId), eq(personAlias.resolution, 'confirmed')));
    const taken = new Set(confirmed.map(({ personId }) => personId));
    const index = indexVotes(evidence);
    const results = [...evidence.timelines.keys()]
        .filter(aliasId => open.has(aliasId))
        .map(aliasId => Object.assign(matchSegments(index, aliasId), { aliasId }));
    const candidates = results
        .flatMap(({ matches }) => matches)
        .filter(
            ({ aliasId, personId, sessionIds }) =>
                !taken.has(personId) &&
                !decisions.hasOtherNickname(aliasId, personId) &&
                !decisions.isRejected(aliasId, personId, sessionIds)
        );
    const allowed = new Set(firstAliasPerPerson(candidates));
    const touched: string[] = [];
    const linked = new Map<string, string>();
    let aliases = 0;
    let segmentLinks = 0;

    for (const { aliasId, segments, matches } of results) {
        const kept = matches.filter(match => allowed.has(match));
        const alias = open.get(aliasId);
        const [first] = kept;
        const assigned = new Map(
            kept.flatMap(({ personId, sessionIds }) =>
                entriesIn(evidence, aliasId, sessionIds).flatMap(({ id, personId: current }) =>
                    isDefined(current) ? [[id, personId] as const] : []
                )
            )
        );
        const agreed =
            kept.length === segments &&
            evidence.entries
                .filter(entry => entry.aliasId === aliasId && entry.resolvedBy !== 'manual' && isDefined(entry.personId))
                .every(entry => (assigned.get(entry.id) ?? entry.personId) === first?.personId);

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
        return entries.every(entry => isOpen(entry)) && playing.length === entries.length
            ? entries.map((entry, index) => ({ entry, personId: playing[index] ?? '' }))
            : [];
    });

const linkSharedNickname = Effect.fn('IngestTelegram.linkSharedNickname')(function* (
    evidence: LinkEvidence,
    decisions: LinkDecisions,
    aliasId: string
) {
    const assignments = splitByGaps(evidence.sharedTimelines.get(aliasId) ?? []).flatMap(segment => {
        const isPossible = (personId: string): boolean => {
            const otherGames = evidence.gamesUnderOtherName(personId, aliasId);

            return (
                segment.every(({ sessionId }) => !otherGames.has(sessionId)) &&
                !decisions.isRejected(
                    aliasId,
                    personId,
                    segment.map(({ sessionId }) => sessionId)
                )
            );
        };

        return matchSet(evidence.squads, segment, isPossible).pipe(
            Option.filter(found => isCertainSet(found)),
            Option.match({
                onNone: () => [],
                onSome: ({ personIds }) => gameAssignments(evidence, aliasId, personIds, segment)
            })
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
    const decisions = yield* loadDecisions(communityId);
    const { aliases, segments, linked } = yield* linkNicknames(communityId, loaded, decisions);
    const open = yield* openAliases(communityId);
    const shared = [...open.values()]
        .filter(({ kind }) => kind === 'placeholder')
        .toSorted((left, right) => right.occurrences - left.occurrences || left.aliasNorm.localeCompare(right.aliasNorm));
    let evidence = withLinks(loaded, linked);
    let sharedEntries = 0;

    for (const { id } of shared) {
        const assigned = yield* linkSharedNickname(evidence, decisions, id);
        evidence = withLinks(evidence, assigned);
        sharedEntries += assigned.size;
    }

    return { aliases, segments, sharedEntries };
});
