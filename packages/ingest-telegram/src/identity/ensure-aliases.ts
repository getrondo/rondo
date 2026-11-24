import { isNotEmptyArray } from '@rnw-community/shared';
import { person, personAlias } from '@rondo/db/schema/identity.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { insertMany } from '../utils/insert-many.util';

import type { SeenAlias } from '../interface/directory.interface';

interface EnsureAliasesInput {
    readonly communityId: string;
    readonly source: 'bot' | 'import';
    readonly aliases: readonly SeenAlias[];
}

export const ensureAliases = Effect.fn('IngestTelegram.ensureAliases')(function* ({ communityId, source, aliases }: EnsureAliasesInput) {
    const db = yield* Db;

    yield* insertMany(aliases, batch =>
        db
            .insert(personAlias)
            .values(
                batch.map(({ personName, ...seen }) => ({
                    ...seen,
                    communityId,
                    resolution: seen.kind === 'self' ? ('confirmed' as const) : ('unresolved' as const)
                }))
            )
            .onConflictDoUpdate({
                target: [personAlias.communityId, personAlias.aliasNorm],
                set: {
                    ...(source === 'import' ? { alias: sql`excluded.alias` } : {}),
                    firstSeenAt: sql`least(${personAlias.firstSeenAt}, excluded.first_seen_at)`,
                    lastSeenAt: sql`greatest(${personAlias.lastSeenAt}, excluded.last_seen_at)`
                }
            })
    );

    const withoutPerson = yield* db
        .select({ id: personAlias.id, alias: personAlias.alias, aliasNorm: personAlias.aliasNorm })
        .from(personAlias)
        .where(and(eq(personAlias.communityId, communityId), isNull(personAlias.personId), ne(personAlias.kind, 'placeholder')));
    const personNames = new Map(aliases.map(({ aliasNorm, personName }) => [aliasNorm, personName]));

    if (isNotEmptyArray(withoutPerson)) {
        const guests = yield* db
            .insert(person)
            .values(withoutPerson.map(({ alias, aliasNorm }) => ({ displayName: personNames.get(aliasNorm) ?? alias, source })))
            .returning({ id: person.id });

        for (const [index, { id }] of withoutPerson.entries()) {
            const personId = guests[index]?.id;
            yield* db.update(personAlias).set({ personId, guestPersonId: personId }).where(eq(personAlias.id, id));
        }
    }
});
