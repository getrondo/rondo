import { isDefined } from '@rnw-community/shared';
import { aliasLink, personAlias } from '@rondo/db/schema/identity.schema';
import { lineupEntry } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, eq, isNotNull, notInArray, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { syncSessionRoster } from '../roster/sync-session-roster';
import { insertMany } from '../utils/insert-many.util';

import { refreshNames } from './refresh-names';

const fixed = ['manual', 'account', 'handle'] as const;

// One player is named once per game: fixed entries first, then approvals from the narrowest, then everything else
export const applyApproved = Effect.fn('IngestTelegram.applyApproved')(function* (communityId: string) {
    const db = yield* Db;
    const inScope = and(eq(session.communityId, communityId), eq(lineupEntry.isGuest, false));
    const columns = {
        id: lineupEntry.id,
        sessionId: lineupEntry.sessionId,
        personId: lineupEntry.personId,
        resolvedBy: lineupEntry.resolvedBy
    };
    const approvals = yield* db
        .select({ ...columns, approved: aliasLink.personId })
        .from(lineupEntry)
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .innerJoin(
            aliasLink,
            and(
                eq(aliasLink.aliasId, lineupEntry.aliasId),
                eq(aliasLink.status, 'approved'),
                sql`${aliasLink.during} @> ${session.localDate}`
            )
        )
        .where(and(inScope, notInArray(lineupEntry.resolvedBy, [...fixed])))
        .orderBy(
            sql`upper(${aliasLink.during}) - lower(${aliasLink.during}) nulls last`,
            asc(aliasLink.personId),
            asc(aliasLink.aliasId),
            asc(lineupEntry.teamOrdinal),
            asc(lineupEntry.position)
        );
    const named = yield* db
        .select({
            ...columns,
            guestPersonId: sql<string | null>`case when ${personAlias.kind} <> 'placeholder' then ${personAlias.guestPersonId} end`
        })
        .from(lineupEntry)
        .innerJoin(session, eq(session.id, lineupEntry.sessionId))
        .leftJoin(personAlias, eq(personAlias.id, lineupEntry.aliasId))
        .where(and(inScope, isNotNull(lineupEntry.personId)));
    const isFixed = new Set<string>(fixed);
    const playing = new Set(named.filter(row => isFixed.has(row.resolvedBy)).map(row => `${row.sessionId}|${row.personId}`));
    const pinned = new Map<string, (typeof approvals)[number]>();

    for (const row of approvals) {
        const player = `${row.sessionId}|${row.approved}`;

        if (!playing.has(player) && !pinned.has(row.id)) {
            playing.add(player);
            pinned.set(row.id, row);
        }
    }

    const changed = [...pinned.values()].filter(row => row.personId !== row.approved || row.resolvedBy !== 'alias');
    const displaced = named.filter(
        row => !isFixed.has(row.resolvedBy) && !pinned.has(row.id) && playing.has(`${row.sessionId}|${row.personId}`)
    );
    const updates = [
        ...changed.map(row => sql`(${row.id}::uuid, ${row.approved}::uuid, 'alias'::play.entry_resolution)`),
        ...displaced.map(
            row =>
                sql`(${row.id}::uuid, ${row.guestPersonId === row.personId ? null : row.guestPersonId}::uuid, 'guest'::play.entry_resolution)`
        )
    ];

    yield* insertMany(updates, batch =>
        db.execute(sql`
            update play.lineup_entry entry set person_id = change.person_id, resolved_by = change.resolved_by
            from (values ${sql.join(batch, sql`, `)}) change (id, person_id, resolved_by) where entry.id = change.id
        `)
    );
    yield* syncSessionRoster([...new Set([...changed, ...displaced].map(row => row.sessionId))]);
    yield* refreshNames(
        [...changed.map(row => row.approved), ...[...changed, ...displaced].map(row => row.personId)].filter(id => isDefined(id))
    );

    return changed.length;
});
