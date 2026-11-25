import { isNotEmptyArray } from '@rnw-community/shared';
import { person } from '@rondo/db/schema/identity.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, inArray, ne, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

const nickname = sql`(
    select linked.alias from play.lineup_entry entry join identity.person_alias linked on linked.id = entry.alias_id
    where entry.person_id = ${person.id} and entry.resolved_by in ('alias', 'vote', 'manual') and linked.kind not in ('self', 'placeholder')
    group by linked.id, linked.alias order by count(*) desc, linked.alias limit 1
)`;

const telegramName = sql`(
    select nullif(concat_ws(' ', account.first_name, nullif(account.last_name, '')), '') from identity.telegram_account account
    where account.person_id = ${person.id}
    order by (concat_ws(' ', account.first_name, nullif(account.last_name, '')) = ${person.displayName}) desc, account.last_seen_at desc limit 1
)`;

const renamedByAdmin = sql`exists (
    select 1 from audit.log entry where entry.action = 'person.rename' and entry.entity_id = ${person.id}::text
)`;

export const refreshNames = Effect.fn('Core.refreshNames')(function* (personIds: readonly string[]) {
    const db = yield* Db;

    if (isNotEmptyArray(personIds)) {
        yield* db
            .update(person)
            .set({ displayName: sql`coalesce(${nickname}, ${telegramName}, ${person.displayName})` })
            .where(and(inArray(person.id, [...new Set(personIds)]), ne(person.source, 'manual'), sql`not ${renamedByAdmin}`));
    }
});
