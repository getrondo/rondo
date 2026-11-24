import { sql } from 'drizzle-orm';
import {
    boolean,
    check,
    doublePrecision,
    index,
    integer,
    jsonb,
    pgSchema,
    primaryKey,
    smallint,
    text,
    uniqueIndex
} from 'drizzle-orm/pg-core';

import { createdAt, id, instant, ref, updatedAt, requiredRef } from './columns';
import { person } from './identity.schema';
import { activity, community } from './org.schema';
import { session } from './scheduling.schema';
import { field } from './venue.schema';

export const play = pgSchema('play');
export const playPrivate = pgSchema('play_private');

export const assignedByEnum = play.enum('assigned_by', ['organizer', 'balancer', 'captain_pick', 'import']);
export const matchStageEnum = play.enum('match_stage', [
    'rotation',
    'round_robin',
    'group',
    'quarter_final',
    'semi_final',
    'final',
    'friendly'
]);
export const matchEventKindEnum = play.enum('match_event_kind', ['goal', 'own_goal', 'assist', 'yellow', 'timeout_2min', 'red', 'injury']);
export const ratingModelEnum = playPrivate.enum('rating_model', ['openskill_pl', 'organizer_seed']);

export const teamColor = play.table(
    'team_color',
    {
        id: id(),
        communityId: requiredRef('community_id', () => community.id),
        name: text('name').notNull(),
        emoji: text('emoji'),
        hex: text('hex')
    },
    t => [uniqueIndex('team_color_name_uq').on(t.communityId, t.name)]
);

export const team = play.table(
    'team',
    {
        id: id(),
        sessionId: requiredRef('session_id', () => session.id),
        colorId: ref('color_id').references(() => teamColor.id, { onDelete: 'set null' }),
        ordinal: smallint('ordinal').notNull(),
        label: text('label'),
        predictedStrength: doublePrecision('predicted_strength'),
        publishedAt: instant('published_at')
    },
    t => [uniqueIndex('team_session_ordinal_uq').on(t.sessionId, t.ordinal)]
);

export const teamMember = play.table(
    'team_member',
    {
        teamId: requiredRef('team_id', () => team.id),
        sessionId: requiredRef('session_id', () => session.id),
        personId: requiredRef('person_id', () => person.id, 'restrict'),
        isGk: boolean('is_gk').notNull().default(false),
        isCaptain: boolean('is_captain').notNull().default(false),
        isNewcomer: boolean('is_newcomer').notNull().default(false),
        assignedBy: assignedByEnum('assigned_by').notNull().default('organizer')
    },
    t => [primaryKey({ columns: [t.teamId, t.personId] }), uniqueIndex('team_member_session_person_uq').on(t.sessionId, t.personId)]
);

export const formatRule = play.table('format_rule', {
    id: id(),
    communityId: requiredRef('community_id', () => community.id),
    name: text('name').notNull(),
    rules: jsonb('rules').notNull(),
    createdAt: createdAt()
});

export const match = play.table(
    'match',
    {
        id: id(),
        sessionId: requiredRef('session_id', () => session.id),
        fieldId: ref('field_id').references(() => field.id, { onDelete: 'set null' }),
        seq: integer('seq').notNull(),
        stage: matchStageEnum('stage').notNull().default('rotation'),
        teamAId: requiredRef('team_a_id', () => team.id),
        teamBId: requiredRef('team_b_id', () => team.id),
        scoreA: smallint('score_a'),
        scoreB: smallint('score_b'),
        startedAt: instant('started_at'),
        endedAt: instant('ended_at')
    },
    t => [uniqueIndex('match_session_seq_uq').on(t.sessionId, t.seq), check('match_distinct_teams_ck', sql`${t.teamAId} <> ${t.teamBId}`)]
);

export const matchEvent = play.table(
    'match_event',
    {
        id: id(),
        matchId: requiredRef('match_id', () => match.id),
        kind: matchEventKindEnum('kind').notNull(),
        personId: ref('person_id').references(() => person.id, { onDelete: 'set null' }),
        teamId: requiredRef('team_id', () => team.id),
        at: instant('at'),
        confirmedBy: ref('confirmed_by').references(() => person.id, { onDelete: 'set null' })
    },
    t => [index('match_event_match_idx').on(t.matchId)]
);

export const rating = playPrivate.table(
    'rating',
    {
        personId: requiredRef('person_id', () => person.id),
        activityId: requiredRef('activity_id', () => activity.id),
        model: ratingModelEnum('model').notNull(),
        mu: doublePrecision('mu').notNull(),
        sigma: doublePrecision('sigma').notNull(),
        games: integer('games').notNull().default(0),
        updatedAt: updatedAt()
    },
    t => [primaryKey({ columns: [t.personId, t.activityId, t.model] })]
);

export const ratingEvent = playPrivate.table(
    'rating_event',
    {
        id: id(),
        personId: requiredRef('person_id', () => person.id),
        activityId: requiredRef('activity_id', () => activity.id),
        model: ratingModelEnum('model').notNull(),
        matchId: ref('match_id').references(() => match.id, { onDelete: 'set null' }),
        muBefore: doublePrecision('mu_before').notNull(),
        muAfter: doublePrecision('mu_after').notNull(),
        sigmaBefore: doublePrecision('sigma_before').notNull(),
        sigmaAfter: doublePrecision('sigma_after').notNull(),
        at: instant('at').notNull().defaultNow()
    },
    t => [index('rating_event_person_idx').on(t.personId, t.at)]
);
