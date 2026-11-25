import { Db } from '@rondo/db/service/db.service';
import { sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

import { syncSessionRoster } from './sync-session-roster';

const ChangedSchema = Schema.Struct({ rows: Schema.Array(Schema.Struct({ session_id: Schema.String })) });

export const markUndecidedTeams = Effect.fn('Core.markUndecidedTeams')(function* (communityId: string) {
    const db = yield* Db;
    const result = yield* db.execute(sql`
        update play.lineup_entry entry set is_team_undecided = not entry.is_team_undecided
        from identity.person_alias alias
        where alias.id = entry.alias_id and alias.community_id = ${communityId}::uuid and entry.is_team_undecided <> (
            alias.kind = 'placeholder' and not entry.is_guest and entry.person_id is not null and entry.resolved_by in ('vote', 'alias')
            and exists (
                select 1 from play.lineup_entry twin where twin.session_id = entry.session_id and twin.alias_id = entry.alias_id
                    and not twin.is_guest and twin.team_ordinal <> entry.team_ordinal
            )
        )
        returning entry.session_id
    `);
    const { rows } = yield* Schema.decodeUnknownEffect(ChangedSchema)(result);

    yield* syncSessionRoster([...new Set(rows.map(row => row.session_id))]);
});
