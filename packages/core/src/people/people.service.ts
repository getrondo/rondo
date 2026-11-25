import { isNotEmptyArray, isNotEmptyString } from '@rnw-community/shared';
import { aliasLink, person, personAlias, telegramAccount } from '@rondo/db/schema/identity.schema';
import { membership } from '@rondo/db/schema/org.schema';
import { attendance, session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { withCommunityLock } from '@rondo/db/service/with-community-lock';
import { and, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';
import { normalizeAlias } from '../extract/normalize';
import { refreshNames } from '../identity/refresh-names';
import { ensureMembership } from '../identity/telegram-user';

import { recordDecision } from './alias-decisions';

interface PersonMatch {
    readonly personId: string;
    readonly name: string;
    readonly aliases: readonly string[];
    readonly telegramUsername: string | null;
    readonly games: number;
}

const inCommunity = (communityId: string): SQL =>
    sql`(exists (select 1 from ${membership} where ${membership.personId} = ${person.id} and ${membership.communityId} = ${communityId})
        or exists (select 1 from identity.person_alias known where known.person_id = ${person.id} and known.community_id = ${communityId}))`;

export const arePeopleOf = Effect.fn('Core.arePeopleOf')(function* (communityId: string, personIds: readonly string[]) {
    const db = yield* Db;
    const wanted = [...new Set(personIds)];

    if (!isNotEmptyArray(wanted)) {
        return true;
    }

    const found = yield* db
        .select({ id: person.id })
        .from(person)
        .where(and(inArray(person.id, wanted), isNull(person.mergedIntoPersonId), inCommunity(communityId)));

    return found.length === wanted.length;
});

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
                inCommunity(communityId),
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
            aliasId: personAlias.id,
            alias: personAlias.alias,
            personId: personAlias.personId,
            occurrences: personAlias.occurrences,
            shared: sql<boolean>`${personAlias.kind} = 'placeholder'`
        })
        .from(personAlias)
        .where(and(eq(personAlias.communityId, communityId), inArray(personAlias.resolution, ['unresolved', 'suggested', 'guest'])))
        .orderBy(desc(personAlias.occurrences))
        .limit(limit);
});

interface MergeInput {
    readonly communityId: string;
    readonly fromPersonId: string;
    readonly intoPersonId: string;
    readonly actorPersonId: string | null;
}

const confirmMergedNicknames = Effect.fn('Core.confirmMergedNicknames')(function* (
    { communityId, intoPersonId, actorPersonId }: MergeInput,
    aliasIds: readonly string[]
) {
    const db = yield* Db;
    const confirmed = yield* db
        .update(personAlias)
        .set({ resolution: 'confirmed' })
        .where(and(inArray(personAlias.id, [...aliasIds]), ne(personAlias.kind, 'placeholder')))
        .returning();

    for (const alias of confirmed) {
        yield* recordDecision({ alias, personId: intoPersonId, status: 'approved', actorPersonId });
    }

    yield* db
        .update(personAlias)
        .set({ guestPersonId: null })
        .where(
            and(
                eq(personAlias.communityId, communityId),
                eq(personAlias.personId, intoPersonId),
                eq(personAlias.guestPersonId, intoPersonId),
                inArray(personAlias.resolution, ['confirmed', 'vote'])
            )
        );
});

export const mergePeople = Effect.fn('Core.mergePeople')((input: MergeInput) =>
    withCommunityLock(
        { id: input.communityId },
        Effect.gen(function* () {
            const db = yield* Db;
            const people = [input.fromPersonId, input.intoPersonId];
            const accounts = yield* db.select().from(telegramAccount).where(inArray(telegramAccount.personId, people));
            const confirmed = yield* db
                .select({ id: personAlias.id })
                .from(personAlias)
                .where(
                    and(
                        eq(personAlias.communityId, input.communityId),
                        inArray(personAlias.personId, isNotEmptyArray(accounts) ? [input.fromPersonId] : people)
                    )
                );
            const rejected = yield* db
                .select({ id: aliasLink.id })
                .from(aliasLink)
                .where(
                    and(
                        inArray(
                            aliasLink.aliasId,
                            confirmed.map(({ id }) => id)
                        ),
                        inArray(aliasLink.personId, people),
                        eq(aliasLink.status, 'rejected')
                    )
                );

            const erased = yield* db.$count(person, and(inArray(person.id, people), isNotNull(person.anonymizedAt)));

            if (erased > 0) {
                return yield* ActionFailedError.make({ failure: { code: 'person_not_found' } });
            }

            if (isNotEmptyArray(rejected)) {
                return yield* ActionFailedError.make({ failure: { code: 'nickname_rejected' } });
            }

            yield* db.execute(sql`select identity.merge_person(${input.fromPersonId}::uuid, ${input.intoPersonId}::uuid)`).pipe(
                Effect.tapError(error => Effect.logWarning('[merge] refused', error)),
                Effect.mapError(() =>
                    ActionFailedError.make({
                        failure: { code: 'records_conflict' }
                    })
                )
            );
            yield* confirmMergedNicknames(
                input,
                confirmed.map(({ id }) => id)
            );
            yield* refreshNames([input.intoPersonId]);
            yield* recordAudit({
                communityId: input.communityId,
                actorPersonId: input.actorPersonId,
                action: 'person.merge',
                entityType: 'person',
                entityId: input.intoPersonId,
                diff: { from: input.fromPersonId }
            });

            return input.intoPersonId;
        })
    )
);

export const createPerson = Effect.fn('Core.createPerson')(function* (input: {
    readonly communityId: string;
    readonly displayName: string;
    readonly actorPersonId: string | null;
}) {
    const db = yield* Db;
    const displayName = input.displayName.trim();

    if (!isNotEmptyString(displayName)) {
        return yield* ActionFailedError.make({ failure: { code: 'name_empty' } });
    }

    return yield* db.transaction(() =>
        Effect.gen(function* () {
            const [created] = yield* db.insert(person).values({ displayName, source: 'manual' }).returning({ id: person.id });
            const personId = created?.id ?? '';
            yield* ensureMembership(input.communityId, personId);
            yield* recordAudit({
                communityId: input.communityId,
                actorPersonId: input.actorPersonId,
                action: 'person.create',
                entityType: 'person',
                entityId: personId
            });

            return personId;
        })
    );
});

export const renamePerson = Effect.fn('Core.renamePerson')(function* (input: {
    readonly communityId: string;
    readonly personId: string;
    readonly displayName: string;
    readonly actorPersonId: string | null;
}) {
    const db = yield* Db;

    const renamed = yield* db
        .update(person)
        .set({ displayName: input.displayName })
        .where(and(eq(person.id, input.personId), isNull(person.anonymizedAt)))
        .returning({ id: person.id });

    if (!isNotEmptyArray(renamed)) {
        return yield* ActionFailedError.make({ failure: { code: 'person_not_found' } });
    }

    return yield* recordAudit({
        communityId: input.communityId,
        actorPersonId: input.actorPersonId,
        action: 'person.rename',
        entityType: 'person',
        entityId: input.personId
    });
});
