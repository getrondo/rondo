import { isNotEmptyArray } from '@rnw-community/shared';
import { activity, community } from '@rondo/db/schema/org.schema';
import { messageRef, pendingAction, telegramPoll } from '@rondo/db/schema/platform.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { venue } from '@rondo/db/schema/venue.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm';
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
            status: session.status,
            chatIds: sql<
                string[]
            >`array(select ${messageRef.chatId}::text from ${messageRef} where ${messageRef.entityId} = ${session.id} and ${messageRef.purpose} = 'poll' order by ${messageRef.createdAt}, ${messageRef.messageId})`
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
        status: row.status,
        chatIds: row.chatIds
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

export const hasOpenPoll = Effect.fn('Core.hasOpenPoll')(function* (sessionId: string) {
    const db = yield* Db;
    const rows = yield* db
        .select({ pollId: telegramPoll.pollId })
        .from(telegramPoll)
        .where(and(eq(telegramPoll.sessionId, sessionId), isNull(telegramPoll.closedAt)))
        .limit(1);

    return isNotEmptyArray(rows);
});

export const lastPollChatOf = Effect.fn('Core.lastPollChatOf')(function* (tgUserId: bigint) {
    const db = yield* Db;
    const [row] = yield* db
        .select({ chatId: sql<string | null>`${pendingAction.payload} ->> 'chatId'` })
        .from(pendingAction)
        .where(
            and(
                eq(pendingAction.requestedByTgUserId, tgUserId),
                inArray(pendingAction.kind, ['create_session', 'announce_session']),
                eq(pendingAction.status, 'confirmed')
            )
        )
        .orderBy(desc(pendingAction.decidedAt))
        .limit(1);

    return row?.chatId ?? null;
});

export const createdGamesBy = Effect.fn('Core.createdGamesBy')(function* (tgUserId: bigint) {
    const db = yield* Db;
    const [row] = yield* db
        .select({ count: sql<number>`count(*)::int` })
        .from(pendingAction)
        .where(
            and(
                eq(pendingAction.requestedByTgUserId, tgUserId),
                eq(pendingAction.kind, 'create_session'),
                eq(pendingAction.status, 'confirmed')
            )
        );

    return row?.count ?? 0;
});
