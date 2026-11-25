import { sql } from 'drizzle-orm';
import {
    bigint,
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
    uniqueIndex,
    uuid
} from 'drizzle-orm/pg-core';

import { createdAt, id, instant, ref, updatedAt, requiredRef } from './columns';
import { person, personAlias, telegramAccount } from './identity.schema';
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
export const lineupDeliveryStatusEnum = play.enum('lineup_delivery_status', ['claimed', 'sent', 'uncertain', 'refused']);

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
        publishedAt: instant('published_at'),
        rank: smallint('rank')
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

export const entryResolutionEnum = play.enum('entry_resolution', ['account', 'handle', 'alias', 'vote', 'manual', 'guest']);

export const lineupEntry = play.table(
    'lineup_entry',
    {
        id: id(),
        sessionId: requiredRef('session_id', () => session.id),
        chatId: bigint('chat_id', { mode: 'number' }),
        messageId: bigint('message_id', { mode: 'number' }).notNull(),
        teamOrdinal: smallint('team_ordinal').notNull(),
        position: smallint('position').notNull(),
        raw: text('raw'),
        aliasId: ref('alias_id').references(() => personAlias.id, { onDelete: 'set null' }),
        tgUserId: bigint('tg_user_id', { mode: 'bigint' }).references(() => telegramAccount.tgUserId, { onDelete: 'set null' }),
        personId: ref('person_id').references(() => person.id, { onDelete: 'restrict' }),
        guestOfPersonId: ref('guest_of_person_id').references(() => person.id, { onDelete: 'restrict' }),
        resolvedBy: entryResolutionEnum('resolved_by').notNull(),
        isGk: boolean('is_gk').notNull().default(false),
        isNewcomer: boolean('is_newcomer').notNull().default(false),
        isGuest: boolean('is_guest').notNull().default(false),
        isTeamUndecided: boolean('is_team_undecided').notNull().default(false)
    },
    t => [
        uniqueIndex('lineup_entry_position_uq').on(t.sessionId, t.teamOrdinal, t.position),
        index('lineup_entry_alias_idx').on(t.aliasId),
        index('lineup_entry_person_idx').on(t.personId),
        check('lineup_entry_player_ck', sql`case when ${t.isGuest} then ${t.personId} is null else ${t.guestOfPersonId} is null end`)
    ]
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
        at: instant('at').notNull().defaultNow(),
        sessionId: ref('session_id').references(() => session.id, { onDelete: 'set null' })
    },
    t => [index('rating_event_person_idx').on(t.personId, t.at)]
);

export const teamDraft = play.table('team_draft', {
    sessionId: ref('session_id')
        .primaryKey()
        .references(() => session.id, { onDelete: 'cascade' }),
    communityId: requiredRef('community_id', () => community.id),
    version: integer('version').notNull().default(1),
    state: jsonb('state').notNull(),
    proposed: jsonb('proposed'),
    proposedAt: instant('proposed_at'),
    changedAt: instant('changed_at'),
    notifiedAt: instant('notified_at'),
    publishedAt: instant('published_at'),
    updatedBy: ref('updated_by').references(() => person.id, { onDelete: 'set null' }),
    updatedAt: updatedAt()
});

export const lineupDelivery = play.table(
    'lineup_delivery',
    {
        sessionId: requiredRef('session_id', () => session.id),
        chatId: bigint('chat_id', { mode: 'bigint' }).notNull(),
        topicId: bigint('topic_id', { mode: 'number' }),
        messageId: bigint('message_id', { mode: 'number' }),
        text: text('text'),
        status: lineupDeliveryStatusEnum('status').notNull(),
        token: uuid('token').notNull().defaultRandom(),
        updatedAt: updatedAt()
    },
    t => [primaryKey({ columns: [t.sessionId, t.chatId] })]
);
