import { boolean, index, pgSchema, smallint, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { createdAt, id, instant, ref, requiredRef } from './columns';
import { recordSourceEnum } from './identity.schema';
import { activity, community } from './org.schema';
import { venue } from './venue.schema';

export const league = pgSchema('league');

export const competitionKindEnum = league.enum('competition_kind', ['league', 'cup', 'tournament', 'friendly']);
export const fixtureStatusEnum = league.enum('fixture_status', ['scheduled', 'played', 'postponed', 'forfeit', 'cancelled']);

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
