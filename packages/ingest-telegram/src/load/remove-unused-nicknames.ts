import { aliasLink, personAlias } from '@rondo/db/schema/identity.schema';
import { lineupEntry, teamMember } from '@rondo/db/schema/play.schema';
import { attendance } from '@rondo/db/schema/scheduling.schema';
import { and, eq, inArray, notExists } from 'drizzle-orm';
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
                notExists(transaction.select().from(lineupEntry).where(eq(lineupEntry.aliasId, personAlias.id))),
                notExists(transaction.select().from(aliasLink).where(eq(aliasLink.aliasId, personAlias.id))),
                notExists(transaction.select().from(teamMember).where(eq(teamMember.personId, personAlias.personId))),
                notExists(transaction.select().from(attendance).where(eq(attendance.personId, personAlias.personId)))
            )
        )
        .returning({ id: personAlias.id });

    return removed.length;
});
