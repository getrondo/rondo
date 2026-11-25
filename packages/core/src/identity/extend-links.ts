// A nickname linked in the main chat is the same player in the squads of other chats within its period
import { Db } from '@rondo/db/service/db.service';
import { sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

import { syncSessionRoster } from '../roster/sync-session-roster';

import { maxGapDays } from './match-votes';
import { refreshNames } from './refresh-names';

const ExtendedSchema = Schema.Struct({ rows: Schema.Array(Schema.Struct({ session_id: Schema.String, person_id: Schema.String })) });

export const extendLinks = Effect.fn('Core.extendLinks')(function* (communityId: string) {
    const db = yield* Db;
    const result = yield* db.execute(sql`
        with linked as (
            select entry.alias_id, entry.person_id, game.local_date
            from play.lineup_entry entry
            join scheduling.session game on game.id = entry.session_id
            join identity.person_alias alias on alias.id = entry.alias_id and alias.kind = 'nickname'
            where game.community_id = ${communityId}::uuid and entry.chat_id is null and not entry.is_guest
                and entry.person_id is not null and entry.resolved_by in ('alias', 'vote')
        ), near as (
            select entry.id, entry.session_id, entry.team_ordinal, entry.position, game.local_date, entry.alias_id,
                (select person_id from linked where linked.alias_id = entry.alias_id
                    and linked.local_date between game.local_date - ${maxGapDays}::int and game.local_date order by local_date desc limit 1) as before,
                (select person_id from linked where linked.alias_id = entry.alias_id
                    and linked.local_date between game.local_date and game.local_date + ${maxGapDays}::int order by local_date limit 1) as after
            from play.lineup_entry entry
            join scheduling.session game on game.id = entry.session_id
            where game.community_id = ${communityId}::uuid and entry.chat_id is not null and not entry.is_guest and entry.resolved_by = 'guest'
        ), chosen as (
            select distinct on (near.session_id, coalesce(before, after)) near.id, coalesce(before, after) as person_id
            from near
            where coalesce(before, after) = coalesce(after, before)
                and not exists (
                    select 1 from play.lineup_entry listed where listed.session_id = near.session_id and listed.person_id = coalesce(before, after)
                )
                and not exists (
                    select 1 from identity.alias_link link where link.alias_id = near.alias_id and link.person_id = coalesce(before, after)
                        and link.status = 'rejected' and link.during @> near.local_date
                )
            order by near.session_id, coalesce(before, after), near.team_ordinal, near.position
        )
        update play.lineup_entry entry set person_id = chosen.person_id, resolved_by = 'alias'
        from chosen where entry.id = chosen.id
        returning entry.session_id, entry.person_id
    `);
    const { rows } = yield* Schema.decodeUnknownEffect(ExtendedSchema)(result);

    yield* syncSessionRoster([...new Set(rows.map(row => row.session_id))]);
    yield* refreshNames(rows.map(row => row.person_id));

    return rows.length;
});
