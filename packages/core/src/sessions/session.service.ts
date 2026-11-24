import { isNotEmptyArray } from '@rnw-community/shared';
import { activity, community } from '@rondo/db/schema/org.schema';
import { attendance, session, sessionChange } from '@rondo/db/schema/scheduling.schema';
import { venue } from '@rondo/db/schema/venue.schema';
import { Db, type Database } from '@rondo/db/service/db.service';
import { and, asc, between, eq, notInArray } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Predicate from 'effect/Predicate';

import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';
import { addMillis } from '../utils/add-millis.util';

import { instantOf, localTimeOf } from './local-time';

import type { CancelReason, SessionPatch, SessionView } from './session.model';

const sessionMinutes = 90;

const selection = {
    id: session.id,
    communityId: session.communityId,
    sport: activity.sport,
    localDate: session.localDate,
    startsAt: session.startsAt,
    status: session.status,
    venueId: session.venueId,
    venueName: venue.name,
    capacityMax: session.capacityMax,
    gkSlots: session.gkSlots,
    title: session.title,
    cancelReason: session.cancelReason,
    timezone: community.timezone
};

type SessionRow = { readonly timezone: string } & Omit<SessionView, 'localTime'>;

const toView = ({ timezone, ...row }: SessionRow): SessionView => ({ ...row, localTime: localTimeOf(row.startsAt, timezone) });

const baseQuery = (db: Database) =>
    db
        .select(selection)
        .from(session)
        .innerJoin(community, eq(community.id, session.communityId))
        .innerJoin(activity, eq(activity.id, session.activityId))
        .leftJoin(venue, eq(venue.id, session.venueId));

export const getSession = Effect.fn('Core.getSession')(function* (sessionId: string) {
    const db = yield* Db;
    const [row] = yield* baseQuery(db).where(eq(session.id, sessionId));

    return Option.fromNullishOr(row).pipe(Option.map(found => toView(found)));
});

export const requireSession = (communityId: string, sessionId: string) =>
    getSession(sessionId).pipe(
        Effect.map(found => found.pipe(Option.filter(target => target.communityId === communityId))),
        Effect.flatMap(found => Effect.fromOption(found)),
        Effect.mapError(() => ActionFailedError.make({ reason: `session ${sessionId} not found` }))
    );

export const listSessions = Effect.fn('Core.listSessions')(function* (
    communityId: string,
    range: { readonly from: string; readonly to: string }
) {
    const db = yield* Db;
    const rows = yield* baseQuery(db)
        .where(and(eq(session.communityId, communityId), between(session.localDate, range.from, range.to)))
        .orderBy(asc(session.startsAt));

    return rows.map(row => toView(row));
});

export const footballActivity = Effect.fn('Core.footballActivity')(function* (communityId: string) {
    const db = yield* Db;
    yield* db.insert(activity).values({ communityId, sport: 'football', name: 'football' }).onConflictDoNothing();
    const [row] = yield* db
        .select({ id: activity.id })
        .from(activity)
        .where(and(eq(activity.communityId, communityId), eq(activity.sport, 'football')));

    return row?.id ?? '';
});

export interface CreateSessionInput {
    readonly communityId: string;
    readonly timezone: string;
    readonly localDate: string;
    readonly localTime: string;
    readonly venueId: string | null;
    readonly capacityMax: number | null;
    readonly title: string | null;
    readonly actorPersonId: string | null;
}

export const createSession = Effect.fn('Core.createSession')(function* (input: CreateSessionInput) {
    const db = yield* Db;
    const activityId = yield* footballActivity(input.communityId);
    const startsAt = instantOf(input.localDate, input.localTime, input.timezone);
    const [row] = yield* db
        .insert(session)
        .values({
            communityId: input.communityId,
            activityId,
            venueId: input.venueId,
            localDate: input.localDate,
            startsAt,
            endsAt: addMillis(startsAt, sessionMinutes * 60_000),
            status: 'open',
            capacityMax: input.capacityMax,
            title: input.title,
            source: 'bot'
        })
        .returning({ id: session.id });
    const sessionId = row?.id ?? '';
    yield* recordAudit({
        communityId: input.communityId,
        actorPersonId: input.actorPersonId,
        action: 'session.create',
        entityType: 'session',
        entityId: sessionId,
        diff: input
    });

    return sessionId;
});

export const updateSession = Effect.fn('Core.updateSession')(function* (
    before: SessionView,
    patch: SessionPatch,
    timezone: string,
    actorPersonId: string | null
) {
    const db = yield* Db;
    const localDate = patch.localDate ?? before.localDate;
    const localTime = patch.localTime ?? before.localTime;
    const startsAt = instantOf(localDate, localTime, timezone);

    yield* db
        .update(session)
        .set({
            localDate,
            startsAt,
            endsAt: addMillis(startsAt, sessionMinutes * 60_000),
            ...(Predicate.isNotUndefined(patch.venueId) ? { venueId: patch.venueId } : {}),
            ...(Predicate.isNotUndefined(patch.capacityMax) ? { capacityMax: patch.capacityMax } : {})
        })
        .where(eq(session.id, before.id));
    yield* db.insert(sessionChange).values({ sessionId: before.id, actorPersonId, diff: { before, patch } });
    yield* recordAudit({
        communityId: before.communityId,
        actorPersonId,
        action: 'session.update',
        entityType: 'session',
        entityId: before.id,
        diff: patch
    });
});

export const cancelSession = Effect.fn('Core.cancelSession')(function* (
    target: SessionView,
    reason: CancelReason,
    actorPersonId: string | null
) {
    const db = yield* Db;

    yield* db.transaction(() =>
        Effect.gen(function* () {
            const cancelled = yield* db
                .update(session)
                .set({ status: 'cancelled', cancelReason: reason })
                .where(and(eq(session.id, target.id), notInArray(session.status, ['played', 'cancelled', 'moved'])))
                .returning({ id: session.id });

            if (!isNotEmptyArray(cancelled)) {
                return yield* ActionFailedError.make({ reason: 'the game is already over or cancelled' });
            }

            yield* db.delete(attendance).where(eq(attendance.sessionId, target.id));
            yield* db.insert(sessionChange).values({ sessionId: target.id, actorPersonId, diff: { status: 'cancelled', reason } });

            return yield* recordAudit({
                communityId: target.communityId,
                actorPersonId,
                action: 'session.cancel',
                entityType: 'session',
                entityId: target.id,
                diff: { reason }
            });
        })
    );
});

export const listVenues = Effect.fn('Core.listVenues')(function* (communityId: string) {
    const db = yield* Db;

    return yield* db
        .select({ id: venue.id, name: venue.name, kind: venue.kind, district: venue.district, indoor: venue.indoor })
        .from(venue)
        .where(and(eq(venue.communityId, communityId), eq(venue.status, 'active')))
        .orderBy(asc(venue.name));
});
