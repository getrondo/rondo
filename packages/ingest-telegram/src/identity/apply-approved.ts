import { Db } from '@rondo/db/service/db.service';
import { sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

import { syncSessionRoster } from '../roster/sync-session-roster';

import { refreshNames } from './refresh-names';

const PinnedSchema = Schema.Struct({ rows: Schema.Array(Schema.Struct({ session_id: Schema.String, person_id: Schema.String })) });

export const applyApproved = Effect.fn('IngestTelegram.applyApproved')(function* (communityId: string) {
    const db = yield* Db;
    const result = yield* db.execute(sql`
        with open_entries as (
            select entry.id, entry.session_id, entry.alias_id, game.local_date,
                row_number() over (partition by entry.session_id, entry.alias_id order by entry.team_ordinal, entry.position) as place
            from play.lineup_entry entry
            join identity.person_alias alias on alias.id = entry.alias_id
            join scheduling.session game on game.id = entry.session_id
            where alias.community_id = ${communityId}::uuid and not entry.is_guest and entry.resolved_by <> 'manual'
        ), approved as (
            select games.session_id, link.alias_id, link.person_id,
                row_number() over (partition by games.session_id, link.alias_id order by link.person_id) as place
            from identity.alias_link link
            join (select distinct session_id, alias_id, local_date from open_entries) games
                on games.alias_id = link.alias_id and link.during @> games.local_date
            where link.status = 'approved' and not exists (
                select 1 from play.lineup_entry taken where taken.session_id = games.session_id and taken.person_id = link.person_id
                    and (taken.alias_id is distinct from link.alias_id or taken.resolved_by = 'manual')
                    and taken.resolved_by <> 'vote'
            )
        )
        update play.lineup_entry entry set person_id = approved.person_id, resolved_by = 'alias'
        from open_entries join approved using (session_id, alias_id, place)
        where entry.id = open_entries.id
        returning entry.session_id, entry.person_id
    `);
    const { rows } = yield* Schema.decodeUnknownEffect(PinnedSchema)(result);

    yield* syncSessionRoster([...new Set(rows.map(row => row.session_id))]);
    yield* refreshNames(rows.map(row => row.person_id));

    return rows.length;
});
