import { personAlias } from '@rondo/db/schema/identity.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

export const countOccurrences = Effect.fn('IngestTelegram.countOccurrences')(function* (communityId: string) {
    const db = yield* Db;

    yield* db
        .update(personAlias)
        .set({
            occurrences: sql`(select count(*) from play.lineup_entry entry where entry.alias_id = ${personAlias.id} and not entry.is_guest)`
        })
        .where(eq(personAlias.communityId, communityId));
});
