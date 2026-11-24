import { sql } from 'drizzle-orm';
import { check, index, pgSchema, primaryKey, smallint, text } from 'drizzle-orm/pg-core';

import { createdAt, id, ref, requiredRef } from './columns';
import { person } from './identity.schema';
import { activity } from './org.schema';
import { session } from './scheduling.schema';

export const feedbackSchema = pgSchema('feedback');
export const feedbackPrivate = pgSchema('feedback_private');

export const incidentKindEnum = feedbackSchema.enum('incident_kind', ['conduct', 'injury', 'safety', 'venue', 'other']);
export const incidentStatusEnum = feedbackSchema.enum('incident_status', ['open', 'reviewing', 'closed']);

const score = (name: string) => smallint(name);

export const feedback = feedbackSchema.table(
    'feedback',
    {
        sessionId: requiredRef('session_id', () => session.id),
        personId: requiredRef('person_id', () => person.id),
        overall: score('overall'),
        teamsFair: score('teams_fair'),
        venueScore: score('venue_score'),
        comment: text('comment'),
        createdAt: createdAt()
    },
    t => [
        primaryKey({ columns: [t.sessionId, t.personId] }),
        check(
            'feedback_scores_ck',
            sql`coalesce(${t.overall}, 3) between 1 and 5 and coalesce(${t.teamsFair}, 3) between 1 and 5 and coalesce(${t.venueScore}, 3) between 1 and 5`
        )
    ]
);

export const mvpVote = feedbackSchema.table(
    'mvp_vote',
    {
        sessionId: requiredRef('session_id', () => session.id),
        voterId: requiredRef('voter_id', () => person.id),
        nomineeId: requiredRef('nominee_id', () => person.id),
        createdAt: createdAt()
    },
    t => [primaryKey({ columns: [t.sessionId, t.voterId] }), check('mvp_vote_self_ck', sql`${t.voterId} <> ${t.nomineeId}`)]
);

export const peerRating = feedbackPrivate.table(
    'peer_rating',
    {
        sessionId: requiredRef('session_id', () => session.id),
        raterId: requiredRef('rater_id', () => person.id),
        rateeId: requiredRef('ratee_id', () => person.id),
        activityId: requiredRef('activity_id', () => activity.id),
        level: smallint('level').notNull(),
        createdAt: createdAt()
    },
    t => [
        primaryKey({ columns: [t.sessionId, t.raterId, t.rateeId] }),
        check('peer_rating_level_ck', sql`${t.level} between 1 and 5`),
        check('peer_rating_self_ck', sql`${t.raterId} <> ${t.rateeId}`)
    ]
);

export const incident = feedbackPrivate.table(
    'incident',
    {
        id: id(),
        sessionId: ref('session_id').references(() => session.id, { onDelete: 'set null' }),
        reporterId: requiredRef('reporter_id', () => person.id),
        subjectPersonId: ref('subject_person_id').references(() => person.id, { onDelete: 'set null' }),
        kind: incidentKindEnum('kind').notNull(),
        body: text('body').notNull(),
        status: incidentStatusEnum('status').notNull().default('open'),
        createdAt: createdAt()
    },
    t => [index('incident_status_idx').on(t.status)]
);
