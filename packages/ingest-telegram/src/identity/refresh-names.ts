import { isNotEmptyArray } from '@rnw-community/shared';
import { person } from '@rondo/db/schema/identity.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, inArray, ne, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

const nickname = sql`(
    select linked.alias from identity.person_alias linked
    where linked.person_id = ${person.id} and linked.resolution in ('confirmed', 'vote') and linked.kind not in ('self', 'placeholder')
    order by linked.occurrences desc, linked.last_seen_at desc limit 1
)`;

const telegramName = sql`(
    select concat_ws(' ', account.first_name, nullif(account.last_name, '')) from identity.telegram_account account
    where account.person_id = ${person.id}
    order by (concat_ws(' ', account.first_name, nullif(account.last_name, '')) = ${person.displayName}) desc, account.last_seen_at desc limit 1
)`;

const renamedByAdmin = sql`exists (
    select 1 from audit.log entry where entry.action = 'person.rename' and entry.entity_id = ${person.id}::text
)`;

export const refreshNames = Effect.fn('IngestTelegram.refreshNames')(function* (personIds: readonly string[]) {
    const db = yield* Db;

    if (isNotEmptyArray(personIds)) {
        yield* db
            .update(person)
            .set({ displayName: sql`coalesce(${nickname}, ${telegramName}, ${person.displayName})` })
            .where(and(inArray(person.id, [...personIds]), ne(person.source, 'manual'), sql`not ${renamedByAdmin}`));
    }
});
