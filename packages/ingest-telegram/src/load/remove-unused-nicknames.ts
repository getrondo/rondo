import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { person, personAlias } from '@rondo/db/schema/identity.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import type { LoadContext } from '../interface/load-context.interface';

export const removeUnusedNicknames = Effect.fn('IngestTelegram.removeUnusedNicknames')(function* ({
    transaction,
    communityId
}: Pick<LoadContext, 'transaction' | 'communityId'>) {
    const removed = yield* transaction
        .delete(personAlias)
        .where(
            and(
                eq(personAlias.communityId, communityId),
                inArray(personAlias.resolution, ['suggested', 'unresolved']),
                notExists(transaction.select({ id: lineupEntry.id }).from(lineupEntry).where(eq(lineupEntry.aliasId, personAlias.id)))
            )
        )
        .returning({ personId: personAlias.personId, guestPersonId: personAlias.guestPersonId });
    const candidates = removed.flatMap(({ personId, guestPersonId }) => [personId, guestPersonId]).filter(id => isDefined(id));

    if (isNotEmptyArray(candidates)) {
        yield* transaction
            .delete(person)
            .where(
                and(
                    inArray(person.id, candidates),
                    eq(person.source, 'import'),
                    sql`not exists (select 1 from identity.person_alias x where ${person.id} in (x.person_id, x.guest_person_id))`,
                    sql`not exists (select 1 from identity.telegram_account x where x.person_id = ${person.id})`,
                    sql`not exists (select 1 from identity.telegram_author x where x.person_id = ${person.id})`,
                    sql`not exists (select 1 from org.membership x where x.person_id = ${person.id})`,
                    sql`not exists (select 1 from org.role_grant x where x.person_id = ${person.id})`,
                    sql`not exists (select 1 from scheduling.signup x where x.person_id = ${person.id})`,
                    sql`not exists (select 1 from scheduling.attendance x where x.person_id = ${person.id})`,
                    sql`not exists (select 1 from play.team_member x where x.person_id = ${person.id})`,
                    sql`not exists (select 1 from play_private.rating x where x.person_id = ${person.id})`,
                    sql`not exists (select 1 from play.lineup_entry x where ${person.id} in (x.person_id, x.guest_of_person_id))`
                )
            );
    }

    return removed.length;
});
