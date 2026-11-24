import { person, personAlias, telegramAuthor } from '@rondo/db/schema/identity.schema';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { insertMany } from '../utils/insert-many.util';
import { lookupId } from '../utils/lookup-id.util';

import type { LoadContext } from '../interface/load-context.interface';

export const insertPeople = Effect.fn('IngestTelegram.insertPeople')(function* ({ transaction, communityId, config, plan }: LoadContext) {
    const organizerName = config.organizers[0] ?? 'Organizer';
    const people = yield* transaction
        .insert(person)
        .values(plan.aliases.map(alias => ({ displayName: alias.isSelf ? organizerName : alias.alias, source: 'import' as const })))
        .returning({ id: person.id });
    const personIdByAlias = new Map(plan.aliases.map((alias, index) => [alias.aliasNorm, people[index]?.id ?? '']));

    yield* insertMany(plan.aliases, batch =>
        transaction.insert(personAlias).values(
            batch.map(alias => ({
                communityId,
                personId: personIdByAlias.get(alias.aliasNorm),
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
    );

    const selfPersonId = lookupId(personIdByAlias, plan.aliases.find(alias => alias.isSelf)?.aliasNorm);

    yield* insertMany(plan.facts.authors, batch =>
        transaction.insert(telegramAuthor).values(
            batch.map(author => ({
                communityId,
                displayName: author.displayName,
                personId: Option.fromNullishOr(selfPersonId).pipe(
                    Option.filter(() => config.organizers.includes(author.displayName)),
                    Option.getOrUndefined
                ),
                messageCount: author.messageCount,
                firstSeenAt: author.firstSeenAt,
                lastSeenAt: author.lastSeenAt
            }))
        )
    );

    return personIdByAlias;
});
