import { isDefined } from '@rnw-community/shared';
import { personAlias, telegramAccount } from '@rondo/db/schema/identity.schema';
import { importedPoll, pollVote } from '@rondo/db/schema/platform.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import type { AliasGame, Squad, VoteEvidence } from './match-votes';

export interface LinkEvidence extends VoteEvidence {
    readonly sharedTimelines: ReadonlyMap<string, readonly AliasGame[]>;
    readonly entries: readonly EvidenceEntry[];
}

export interface EvidenceEntry {
    readonly id: string;
    readonly sessionId: string;
    readonly aliasId: string | null;
    readonly personId: string | null;
    readonly resolvedBy: (typeof lineupEntry.$inferSelect)['resolvedBy'];
    readonly kind: (typeof personAlias.$inferSelect)['kind'] | null;
    readonly isMain: boolean;
    readonly date: string;
}

const timelinesOf = (entries: readonly EvidenceEntry[], squadById: ReadonlyMap<string, Squad>): Map<string, AliasGame[]> => {
    const players = new Map<string, Map<string, number>>();

    for (const { aliasId, sessionId, resolvedBy } of entries) {
        if (isDefined(aliasId) && resolvedBy !== 'manual') {
            const games = players.get(aliasId) ?? new Map<string, number>();
            games.set(sessionId, (games.get(sessionId) ?? 0) + 1);
            players.set(aliasId, games);
        }
    }

    return new Map(
        [...players].map(([aliasId, games]) => [
            aliasId,
            [...games].flatMap(([sessionId, count]) => {
                const squad = squadById.get(sessionId);

                return isDefined(squad) ? [{ ...squad, players: count }] : [];
            })
        ])
    );
};

const entryIndex = (entries: readonly EvidenceEntry[]): Pick<LinkEvidence, 'entries' | 'gamesUnderOtherName'> => {
    const byPerson = new Map<string, EvidenceEntry[]>();

    for (const entry of entries) {
        if (isDefined(entry.personId)) {
            byPerson.set(entry.personId, [...(byPerson.get(entry.personId) ?? []), entry]);
        }
    }

    return {
        entries,
        gamesUnderOtherName: (personId, aliasId) =>
            new Set((byPerson.get(personId) ?? []).filter(entry => entry.aliasId !== aliasId).map(({ sessionId }) => sessionId))
    };
};

const withPerson = (entry: EvidenceEntry, personId: string | undefined): EvidenceEntry =>
    isDefined(personId) ? { ...entry, personId } : entry;

export const withLinks = (evidence: LinkEvidence, personIdByEntry: ReadonlyMap<string, string>): LinkEvidence => ({
    ...evidence,
    ...entryIndex(evidence.entries.map(entry => withPerson(entry, personIdByEntry.get(entry.id))))
});

export const loadEvidence = Effect.fn('IngestTelegram.loadEvidence')(function* (communityId: string, isMainOnly = false) {
    const db = yield* Db;
    const votes = yield* db
        .selectDistinctOn([pollVote.sessionId, telegramAccount.personId], {
            sessionId: pollVote.sessionId,
            personId: telegramAccount.personId,
            choice: pollVote.choice
        })
        .from(pollVote)
        .innerJoin(session, eq(session.id, pollVote.sessionId))
        .innerJoin(telegramAccount, eq(telegramAccount.tgUserId, pollVote.tgUserId))
        .leftJoin(importedPoll, eq(importedPoll.pollId, pollVote.pollId))
        .where(
            and(
                eq(session.communityId, communityId),
                inArray(pollVote.choice, ['yes', 'no']),
                ...(isMainOnly ? [isNull(importedPoll.chatId)] : [])
            )
        )
        .orderBy(pollVote.sessionId, telegramAccount.personId, desc(pollVote.votedAt));
    const entries: EvidenceEntry[] = yield* db
        .select({
            id: lineupEntry.id,
            sessionId: lineupEntry.sessionId,
            aliasId: lineupEntry.aliasId,
            personId: lineupEntry.personId,
            resolvedBy: lineupEntry.resolvedBy,
            kind: personAlias.kind,
            isMain: sql<boolean>`${lineupEntry.chatId} is null`,
            date: session.localDate
        })
        .from(lineupEntry)
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .leftJoin(personAlias, eq(personAlias.id, lineupEntry.aliasId))
        .where(
            and(
                eq(session.communityId, communityId),
                eq(lineupEntry.isGuest, false),
                ne(session.status, 'cancelled'),
                ...(isMainOnly ? [isNull(lineupEntry.chatId)] : [])
            )
        )
        .orderBy(asc(session.localDate), asc(lineupEntry.sessionId), asc(lineupEntry.teamOrdinal), asc(lineupEntry.position));
    const yesBySession = new Map<string, Set<string>>();

    for (const { choice, sessionId, personId } of votes) {
        const yes = yesBySession.get(sessionId ?? '') ?? new Set();
        yesBySession.set(sessionId ?? '', choice === 'yes' && isDefined(personId) ? yes.add(personId) : yes);
    }

    const squadById = new Map<string, Squad>(
        entries.map(({ sessionId, date }) => [sessionId, { sessionId, date, yes: yesBySession.get(sessionId) ?? null }])
    );

    return {
        squads: [...squadById.values()],
        timelines: timelinesOf(
            entries.filter(({ kind }) => kind === 'nickname'),
            squadById
        ),
        sharedTimelines: timelinesOf(
            entries.filter(({ kind }) => kind === 'placeholder'),
            squadById
        ),
        ...entryIndex(entries)
    } satisfies LinkEvidence;
});
