import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { person, personAlias, telegramAuthor } from '@rondo/db/schema/identity.schema';
import { eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { insertMany } from '../utils/insert-many.util';
import { lookupId } from '../utils/lookup-id.util';

import type { LoadContext } from '../interface/load-context.interface';

const createPersonsForNewAliases = Effect.fn('IngestTelegram.createPersonsForNewAliases')(function* ({
    transaction,
    communityId,
    config,
    plan
}: LoadContext) {
    const organizerName = config.organizers[0] ?? 'Organizer';
    const existing = yield* transaction
        .select({ aliasNorm: personAlias.aliasNorm })
        .from(personAlias)
        .where(eq(personAlias.communityId, communityId));
    const existingNorms = new Set(existing.map(row => row.aliasNorm));
    const created = plan.aliases.filter(alias => !existingNorms.has(alias.aliasNorm));

    if (!isNotEmptyArray(created)) {
        return new Map<string, string>();
    }

    const people = yield* transaction
        .insert(person)
        .values(created.map(alias => ({ displayName: alias.isSelf ? organizerName : alias.alias, source: 'import' as const })))
        .returning({ id: person.id });

    return new Map(created.map((alias, index) => [alias.aliasNorm, people[index]?.id ?? '']));
});

export const insertPeople = Effect.fn('IngestTelegram.insertPeople')(function* (context: LoadContext) {
    const { transaction, communityId, config, plan } = context;
    const createdPersonIds = yield* createPersonsForNewAliases(context);

    yield* insertMany(plan.aliases, batch =>
        transaction
            .insert(personAlias)
            .values(
                batch.map(alias => ({
                    communityId,
                    personId: createdPersonIds.get(alias.aliasNorm),
                    alias: alias.alias,
                    aliasNorm: alias.aliasNorm,
                    kind: alias.isSelf ? ('self' as const) : ('nickname' as const),
                    occurrences: alias.occurrences,
                    firstSeenAt: new Date(`${alias.firstSeen}T12:00:00Z`),
                    lastSeenAt: new Date(`${alias.lastSeen}T12:00:00Z`),
                    resolution: alias.isSelf ? ('confirmed' as const) : ('suggested' as const),
                    confidence: alias.isSelf ? 1 : 0.5
                }))
            )
            .onConflictDoUpdate({
                target: [personAlias.communityId, personAlias.aliasNorm],
                set: {
                    occurrences: sql`excluded.occurrences`,
                    firstSeenAt: sql`excluded.first_seen_at`,
                    lastSeenAt: sql`excluded.last_seen_at`
                }
            })
    );

    const storedAliases = yield* transaction
        .select({ aliasNorm: personAlias.aliasNorm, personId: personAlias.personId })
        .from(personAlias)
        .where(eq(personAlias.communityId, communityId));
    const personIdByAlias = new Map(
        storedAliases.flatMap(row => (isDefined(row.personId) ? [[row.aliasNorm, row.personId] as const] : []))
    );
    const selfPersonId = lookupId(personIdByAlias, plan.aliases.find(alias => alias.isSelf)?.aliasNorm);

    yield* insertMany(plan.facts.authors, batch =>
        transaction
            .insert(telegramAuthor)
            .values(
                batch.map(author => ({
                    communityId,
                    displayName: author.displayName,
                    personId: Option.fromNullishOr(selfPersonId).pipe(
                        Option.filter(() => author.displayName === config.organizers[0]),
                        Option.getOrUndefined
                    ),
                    messageCount: author.messageCount,
                    firstSeenAt: author.firstSeenAt,
                    lastSeenAt: author.lastSeenAt
                }))
            )
            .onConflictDoUpdate({
                target: [telegramAuthor.communityId, telegramAuthor.displayName],
                set: {
                    personId: sql`coalesce(${telegramAuthor.personId}, excluded.person_id)`,
                    messageCount: sql`excluded.message_count`,
                    firstSeenAt: sql`excluded.first_seen_at`,
                    lastSeenAt: sql`excluded.last_seen_at`
                }
            })
    );

    return personIdByAlias;
});
