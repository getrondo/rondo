import { Db } from '@rondo/db/service/db.service';
import { sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

export const alignGuests = Effect.fn('Core.alignGuests')(function* (communityId: string) {
    const db = yield* Db;

    yield* db.execute(sql`
        update play.lineup_entry guest set guest_of_person_id = coalesce((
            select (array_agg(host.person_id))[1] from play.lineup_entry host
            where host.session_id = guest.session_id and host.alias_id = guest.alias_id and not host.is_guest
            having count(*) = 1
        ), alias.person_id)
        from identity.person_alias alias
        where alias.id = guest.alias_id and guest.is_guest and alias.community_id = ${communityId}::uuid
    `);
});
