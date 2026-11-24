import { isDefined } from '@rnw-community/shared';
import { personAlias, telegramAccount } from '@rondo/db/schema/identity.schema';
import { pollVote } from '@rondo/db/schema/platform.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import type { AliasGame, Squad, VoteEvidence } from './match-votes';

export interface LinkEvidence extends VoteEvidence {
    readonly sharedTimelines: ReadonlyMap<string, readonly AliasGame[]>;
    readonly entries: readonly EvidenceEntry[];
}

interface EvidenceEntry {
    readonly id: string;
    readonly sessionId: string;
    readonly aliasId: string | null;
    readonly personId: string | null;
    readonly resolvedBy: (typeof lineupEntry.$inferSelect)['resolvedBy'];
    readonly kind: (typeof personAlias.$inferSelect)['kind'] | null;
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

export const loadEvidence = Effect.fn('IngestTelegram.loadEvidence')(function* (communityId: string) {
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
    const entries: EvidenceEntry[] = yield* db
        .select({
            id: lineupEntry.id,
            sessionId: lineupEntry.sessionId,
            aliasId: lineupEntry.aliasId,
            personId: lineupEntry.personId,
            resolvedBy: lineupEntry.resolvedBy,
            kind: personAlias.kind,
            date: session.localDate
        })
        .from(lineupEntry)
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .leftJoin(personAlias, eq(personAlias.id, lineupEntry.aliasId))
        .where(and(eq(session.communityId, communityId), eq(lineupEntry.isGuest, false), ne(session.status, 'cancelled')))
        .orderBy(asc(session.localDate), asc(lineupEntry.sessionId), asc(lineupEntry.teamOrdinal), asc(lineupEntry.position));
    const yesBySession = new Map<string, Set<bigint>>();

    for (const { choice, sessionId, tgUserId } of votes) {
        const yes = yesBySession.get(sessionId ?? '') ?? new Set();
        yesBySession.set(sessionId ?? '', choice === 'yes' ? yes.add(tgUserId) : yes);
    }

    const squadById = new Map<string, Squad>(
        entries.map(({ sessionId, date }) => [sessionId, { sessionId, date, yes: yesBySession.get(sessionId) ?? null }])
    );

    return {
        squads: [...squadById.values()],
        personIdByAccount: new Map(votes.flatMap(({ tgUserId, personId }) => (isDefined(personId) ? [[tgUserId, personId] as const] : []))),
        timelines: timelinesOf(
            entries.filter(({ kind }) => kind === 'nickname'),
            squadById
        ),
        sharedTimelines: timelinesOf(
            entries.filter(({ kind }) => kind === 'placeholder'),
            squadById
        ),
        entries,
        gamesUnderOtherName: (personId, aliasId) =>
            new Set(entries.filter(entry => entry.personId === personId && entry.aliasId !== aliasId).map(entry => entry.sessionId))
    } satisfies LinkEvidence;
});
