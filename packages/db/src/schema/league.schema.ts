import { sql } from 'drizzle-orm';
import { boolean, index, pgSchema, primaryKey, smallint, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { createdAt, daterange, id, instant, ref, requiredRef } from './columns';
import { person, recordSourceEnum } from './identity.schema';
import { activity, community } from './org.schema';
import { venue } from './venue.schema';

export const league = pgSchema('league');

export const competitionKindEnum = league.enum('competition_kind', ['league', 'cup', 'tournament', 'friendly']);
export const fixtureStatusEnum = league.enum('fixture_status', ['scheduled', 'played', 'postponed', 'forfeit', 'cancelled']);
export const availabilityEnum = league.enum('availability', ['available', 'maybe', 'unavailable']);
export const fixtureEventKindEnum = league.enum('fixture_event_kind', ['goal', 'assist', 'yellow', 'red', 'motm']);
export const awardKindEnum = league.enum('award_kind', [
    'mvp',
    'top_scorer',
    'best_gk',
    'iron_man',
    'best_newcomer',
    'hall_of_fame',
    'other'
]);

export const competition = league.table(
    'competition',
    {
        id: id(),
        communityId: requiredRef('community_id', () => community.id),
        organizer: text('organizer'),
        name: text('name').notNull(),
        season: text('season'),
        kind: competitionKindEnum('kind').notNull(),
        level: text('level'),
        createdAt: createdAt()
    },
    t => [uniqueIndex('competition_name_season_uq').on(t.communityId, t.name, t.season)]
);

export const squad = league.table(
    'squad',
    {
        id: id(),
        communityId: requiredRef('community_id', () => community.id),
        activityId: ref('activity_id').references(() => activity.id, { onDelete: 'set null' }),
        name: text('name').notNull()
    },
    t => [uniqueIndex('squad_name_uq').on(t.communityId, t.name)]
);

export const squadMember = league.table(
    'squad_member',
    {
        squadId: requiredRef('squad_id', () => squad.id),
        personId: requiredRef('person_id', () => person.id),
        shirtNumber: smallint('shirt_number'),
        valid: daterange('valid')
            .notNull()
            .default(sql`'(,)'`)
    },
    t => [primaryKey({ columns: [t.squadId, t.personId] })]
);

export const opponent = league.table(
    'opponent',
    {
        id: id(),
        communityId: requiredRef('community_id', () => community.id),
        name: text('name').notNull(),
        aliases: text('aliases').array().notNull().default([])
    },
    t => [uniqueIndex('opponent_name_uq').on(t.communityId, t.name)]
);

export const fixture = league.table(
    'fixture',
    {
        id: id(),
        competitionId: ref('competition_id').references(() => competition.id, { onDelete: 'set null' }),
        squadId: ref('squad_id').references(() => squad.id, { onDelete: 'set null' }),
        opponentId: requiredRef('opponent_id', () => opponent.id, 'restrict'),
        venueId: ref('venue_id').references(() => venue.id, { onDelete: 'set null' }),
        kickoffAt: instant('kickoff_at'),
        playedOn: text('played_on'),
        home: boolean('home'),
        stage: text('stage'),
        goalsFor: smallint('goals_for'),
        goalsAgainst: smallint('goals_against'),
        penaltiesFor: smallint('penalties_for'),
        penaltiesAgainst: smallint('penalties_against'),
        status: fixtureStatusEnum('status').notNull().default('scheduled'),
        source: recordSourceEnum('source').notNull().default('bot'),
        createdAt: createdAt()
    },
    t => [index('fixture_squad_idx').on(t.squadId, t.kickoffAt)]
);

export const fixtureAvailability = league.table(
    'fixture_availability',
    {
        fixtureId: requiredRef('fixture_id', () => fixture.id),
        personId: requiredRef('person_id', () => person.id),
        status: availabilityEnum('status').notNull(),
        calledUp: boolean('called_up').notNull().default(false)
    },
    t => [primaryKey({ columns: [t.fixtureId, t.personId] })]
);

export const fixtureEvent = league.table(
    'fixture_event',
    {
        id: id(),
        fixtureId: requiredRef('fixture_id', () => fixture.id),
        kind: fixtureEventKindEnum('kind').notNull(),
        personId: ref('person_id').references(() => person.id, { onDelete: 'set null' }),
        minute: smallint('minute')
    },
    t => [index('fixture_event_fixture_idx').on(t.fixtureId)]
);

export const award = league.table('award', {
    id: id(),
    communityId: requiredRef('community_id', () => community.id),
    season: text('season'),
    kind: awardKindEnum('kind').notNull(),
    personId: requiredRef('person_id', () => person.id),
    note: text('note'),
    createdAt: createdAt()
});
