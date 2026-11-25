import { isNotEmptyArray } from '@rnw-community/shared';
import { activity, community } from '@rondo/db/schema/org.schema';
import { messageRef } from '@rondo/db/schema/platform.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { venue } from '@rondo/db/schema/venue.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, desc, eq, gte, inArray, isNotNull, notInArray, or, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { localTimeOf } from '../sessions/local-time';

import type { PastGame, PlannedGame } from './past-game.interface';

type VenueKind = (typeof venue.kind.enumValues)[number];

const historyLimit = 600;

export const footballHistory = Effect.fn('Core.footballHistory')(function* (
    communityId: string,
    since: string,
    kinds: readonly VenueKind[]
) {
    const db = yield* Db;
    const rows = yield* db
        .select({
            localDate: session.localDate,
            startsAt: session.startsAt,
            timezone: community.timezone,
            venueId: session.venueId,
            fieldsPlanned: session.fieldsPlanned,
            capacityMax: session.capacityMax,
            status: session.status
        })
        .from(session)
        .innerJoin(activity, eq(activity.id, session.activityId))
        .innerJoin(community, eq(community.id, session.communityId))
        .innerJoin(venue, eq(venue.id, session.venueId))
        .where(
            and(
                eq(session.communityId, communityId),
                eq(activity.sport, 'football'),
                gte(session.localDate, since),
                inArray(venue.kind, [...kinds])
            )
        )
        .orderBy(desc(session.startsAt))
        .limit(historyLimit);

    return rows.map((row): PastGame => ({
        localDate: row.localDate,
        localTime: localTimeOf(row.startsAt, row.timezone),
        venueId: row.venueId,
        fieldsPlanned: row.fieldsPlanned,
        capacityMax: row.capacityMax,
        status: row.status
    }));
});

export const plannedFootball = Effect.fn('Core.plannedFootball')(function* (communityId: string, from: string) {
    const db = yield* Db;
    const rows = yield* db
        .select({
            sessionId: session.id,
            localDate: session.localDate,
            hasPoll: sql<boolean>`exists (select 1 from ${messageRef} where ${messageRef.entityId} = ${session.id} and ${messageRef.purpose} = 'poll')`
        })
        .from(session)
        .innerJoin(activity, eq(activity.id, session.activityId))
        .where(
            and(
                eq(session.communityId, communityId),
                eq(activity.sport, 'football'),
                gte(session.localDate, from),
                notInArray(session.status, ['cancelled', 'moved', 'played', 'draft'])
            )
        )
        .orderBy(asc(session.startsAt));

    return rows.map((row): PlannedGame => row);
});

export const venueChoices = Effect.fn('Core.venueChoices')(function* (communityId: string, kinds: readonly VenueKind[]) {
    const db = yield* Db;

    return yield* db
        .select({
            id: venue.id,
            name: venue.name,
            label: sql<string>`coalesce(${venue.shortName}, ${venue.name})`,
            located: sql<boolean>`${or(isNotNull(venue.address), isNotNull(venue.lat), isNotNull(venue.mapUrl))}`
        })
        .from(venue)
        .where(and(eq(venue.communityId, communityId), eq(venue.status, 'active'), inArray(venue.kind, [...kinds])))
        .orderBy(asc(venue.name));
});

export const hasPollFor = Effect.fn('Core.hasPollFor')(function* (sessionId: string) {
    const db = yield* Db;
    const rows = yield* db
        .select({ messageId: messageRef.messageId })
        .from(messageRef)
        .where(and(eq(messageRef.entityId, sessionId), eq(messageRef.purpose, 'poll')))
        .limit(1);

    return isNotEmptyArray(rows);
});
