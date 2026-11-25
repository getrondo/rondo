import { sql } from 'drizzle-orm';
import {
    boolean,
    check,
    date,
    index,
    interval,
    jsonb,
    numeric,
    pgSchema,
    primaryKey,
    smallint,
    text,
    time,
    uniqueIndex
} from 'drizzle-orm/pg-core';

import { createdAt, daterange, id, instant, ref, updatedAt, requiredRef } from './columns';
import { person, recordSourceEnum } from './identity.schema';
import { activity, community } from './org.schema';
import { venue } from './venue.schema';

export const scheduling = pgSchema('scheduling');

export const sessionStatusEnum = scheduling.enum('session_status', ['draft', 'open', 'full', 'locked', 'played', 'cancelled', 'moved']);
export const sessionKindEnum = scheduling.enum('session_kind', ['casual', 'training', 'tournament', 'event']);
export const cancelReasonEnum = scheduling.enum('cancel_reason', ['weather', 'low_turnout', 'venue', 'holiday', 'organizer', 'other']);
export const sessionReviewEnum = scheduling.enum('session_review', ['unclear_cancellation']);
export const signupRoleEnum = scheduling.enum('signup_role', ['field', 'gk']);
export const signupStatusEnum = scheduling.enum('signup_status', ['in', 'maybe', 'out', 'waitlisted', 'offered']);
export const signupPriorityEnum = scheduling.enum('signup_priority', ['normal', 'held', 'reserve_bonus']);
export const attendanceOutcomeEnum = scheduling.enum('attendance_outcome', ['attended', 'no_show', 'late', 'left_early', 'excused']);

export const series = scheduling.table('series', {
    id: id(),
    communityId: requiredRef('community_id', () => community.id),
    activityId: requiredRef('activity_id', () => activity.id),
    venueId: ref('venue_id').references(() => venue.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    rrule: text('rrule').notNull(),
    localStart: time('local_start').notNull(),
    duration: interval('duration').notNull(),
    capacityMin: smallint('capacity_min'),
    capacityMax: smallint('capacity_max'),
    gkSlots: smallint('gk_slots').notNull().default(0),
    publishOffset: interval('publish_offset'),
    cancelCutoffOffset: interval('cancel_cutoff_offset'),
    active: daterange('active').notNull(),
    createdAt: createdAt()
});

export const session = scheduling.table(
    'session',
    {
        id: id(),
        communityId: requiredRef('community_id', () => community.id),
        activityId: requiredRef('activity_id', () => activity.id, 'restrict'),
        seriesId: ref('series_id').references(() => series.id, { onDelete: 'set null' }),
        venueId: ref('venue_id').references(() => venue.id, { onDelete: 'set null' }),
        kind: sessionKindEnum('kind').notNull().default('casual'),
        localDate: date('local_date', { mode: 'string' }).notNull(),
        startsAt: instant('starts_at').notNull(),
        endsAt: instant('ends_at'),
        status: sessionStatusEnum('status').notNull().default('draft'),
        capacityMin: smallint('capacity_min'),
        capacityMax: smallint('capacity_max'),
        gkSlots: smallint('gk_slots').notNull().default(0),
        fieldsPlanned: smallint('fields_planned'),
        format: text('format'),
        signupOpensAt: instant('signup_opens_at'),
        cancelCutoffAt: instant('cancel_cutoff_at'),
        cancelReason: cancelReasonEnum('cancel_reason'),
        reviewReason: sessionReviewEnum('review_reason'),
        movedToSessionId: ref('moved_to_session_id'),
        title: text('title'),
        source: recordSourceEnum('source').notNull().default('bot'),
        confidence: numeric('confidence', { precision: 3, scale: 2, mode: 'number' }),
        createdAt: createdAt(),
        updatedAt: updatedAt()
    },
    t => [
        index('session_community_date_idx').on(t.communityId, t.localDate),
        index('session_venue_idx').on(t.venueId),
        check('session_moved_ck', sql`(${t.movedToSessionId} is null) or (${t.status} = 'moved')`),
        check('session_capacity_ck', sql`${t.capacityMin} is null or ${t.capacityMax} is null or ${t.capacityMin} <= ${t.capacityMax}`),
        check('session_time_ck', sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`)
    ]
);

export const sessionChange = scheduling.table(
    'session_change',
    {
        id: id(),
        sessionId: requiredRef('session_id', () => session.id),
        at: instant('at').notNull().defaultNow(),
        actorPersonId: ref('actor_person_id').references(() => person.id, { onDelete: 'set null' }),
        diff: jsonb('diff').notNull(),
        notified: boolean('notified').notNull().default(false)
    },
    t => [index('session_change_session_idx').on(t.sessionId, t.at)]
);

export const signup = scheduling.table(
    'signup',
    {
        id: id(),
        sessionId: requiredRef('session_id', () => session.id),
        personId: requiredRef('person_id', () => person.id, 'restrict'),
        role: signupRoleEnum('role').notNull().default('field'),
        status: signupStatusEnum('status').notNull(),
        guestOfPersonId: ref('guest_of_person_id').references(() => person.id, { onDelete: 'set null' }),
        isGuest: boolean('is_guest').notNull().default(false),
        priority: signupPriorityEnum('priority').notNull().default('normal'),
        createdAt: createdAt(),
        updatedAt: updatedAt()
    },
    t => [uniqueIndex('signup_session_person_uq').on(t.sessionId, t.personId)]
);

export const signupEvent = scheduling.table(
    'signup_event',
    {
        id: id(),
        signupId: requiredRef('signup_id', () => signup.id),
        at: instant('at').notNull().defaultNow(),
        fromStatus: signupStatusEnum('from_status'),
        toStatus: signupStatusEnum('to_status').notNull(),
        actorPersonId: ref('actor_person_id').references(() => person.id, { onDelete: 'set null' }),
        late: boolean('late').notNull().default(false)
    },
    t => [index('signup_event_signup_idx').on(t.signupId, t.at)]
);

export const attendance = scheduling.table(
    'attendance',
    {
        sessionId: requiredRef('session_id', () => session.id),
        personId: requiredRef('person_id', () => person.id, 'restrict'),
        outcome: attendanceOutcomeEnum('outcome').notNull(),
        lateMinutes: smallint('late_minutes'),
        recordedBy: ref('recorded_by').references(() => person.id, { onDelete: 'set null' }),
        source: recordSourceEnum('source').notNull().default('bot')
    },
    t => [primaryKey({ columns: [t.sessionId, t.personId] }), index('attendance_person_idx').on(t.personId)]
);
