import { person, personAlias, telegramAccount } from '@rondo/db/schema/identity.schema';
import { attendance, session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { normalizeAlias } from '@rondo/ingest-telegram/extract/normalize';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { recordAudit } from '../audit/record-audit';

interface PersonMatch {
    readonly personId: string;
    readonly name: string;
    readonly aliases: readonly string[];
    readonly telegramUsername: string | null;
    readonly games: number;
}

export const searchPeople = Effect.fn('Core.searchPeople')(function* (communityId: string, query: string, limit: number) {
    const db = yield* Db;
    const pattern = `%${query.trim()}%`;
    const normalized = `%${normalizeAlias(query)}%`;
    const rows = yield* db
        .select({
            personId: person.id,
            name: person.displayName,
            aliases: sql<
                string[]
            >`coalesce(array_agg(distinct ${personAlias.alias}) filter (where ${personAlias.alias} is not null), '{}')`,
            telegramUsername: sql<string | null>`max(${telegramAccount.username})`,
            games: sql<number>`(select count(*)::int from ${attendance} join ${session} on ${session.id} = ${attendance.sessionId} where ${attendance.personId} = ${person.id} and ${session.communityId} = ${communityId})`
        })
        .from(person)
        .leftJoin(personAlias, and(eq(personAlias.personId, person.id), eq(personAlias.communityId, communityId)))
        .leftJoin(telegramAccount, eq(telegramAccount.personId, person.id))
        .where(
            and(
                isNull(person.mergedIntoPersonId),
                or(ilike(person.displayName, pattern), ilike(personAlias.aliasNorm, normalized), ilike(telegramAccount.username, pattern))
            )
        )
        .groupBy(person.id, person.displayName)
        .limit(limit);

    return rows.toSorted((left, right) => right.games - left.games) satisfies PersonMatch[];
});

export const unresolvedAliases = Effect.fn('Core.unresolvedAliases')(function* (communityId: string, limit: number) {
    const db = yield* Db;

    return yield* db
        .select({
            alias: personAlias.alias,
            personId: personAlias.personId,
            occurrences: personAlias.occurrences,
            resolution: personAlias.resolution
        })
        .from(personAlias)
        .where(
            and(
                eq(personAlias.communityId, communityId),
                or(eq(personAlias.resolution, 'unresolved'), eq(personAlias.resolution, 'suggested'))
            )
        )
        .orderBy(desc(personAlias.occurrences))
        .limit(limit);
});

export const mergePeople = Effect.fn('Core.mergePeople')(function* (input: {
    readonly communityId: string;
    readonly fromPersonId: string;
    readonly intoPersonId: string;
    readonly actorPersonId: string | null;
}) {
    const db = yield* Db;

    yield* db.transaction(transaction =>
        Effect.gen(function* () {
            yield* transaction.execute(sql`select identity.merge_person(${input.fromPersonId}::uuid, ${input.intoPersonId}::uuid)`);
            yield* transaction
                .update(personAlias)
                .set({ resolution: 'confirmed', confidence: 1 })
                .where(and(eq(personAlias.communityId, input.communityId), eq(personAlias.personId, input.intoPersonId)));
        })
    );
    yield* recordAudit({
        communityId: input.communityId,
        actorPersonId: input.actorPersonId,
        action: 'person.merge',
        entityType: 'person',
        entityId: input.intoPersonId,
        diff: { from: input.fromPersonId }
    });
});

export const renamePerson = Effect.fn('Core.renamePerson')(function* (input: {
    readonly communityId: string;
    readonly personId: string;
    readonly displayName: string;
    readonly actorPersonId: string | null;
}) {
    const db = yield* Db;

    yield* db.update(person).set({ displayName: input.displayName }).where(eq(person.id, input.personId));
    yield* recordAudit({
        communityId: input.communityId,
        actorPersonId: input.actorPersonId,
        action: 'person.rename',
        entityType: 'person',
        entityId: input.personId,
        diff: { displayName: input.displayName }
    });
});
