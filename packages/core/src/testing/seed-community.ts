import { community } from '@rondo/db/schema/org.schema';
import { teamColor } from '@rondo/db/schema/play.schema';
import { venue } from '@rondo/db/schema/venue.schema';
import { Db } from '@rondo/db/service/db.service';
import * as Effect from 'effect/Effect';

import type { CommunityConfig } from '../config/community-config';

export const seedConfig = (slug: string): CommunityConfig => ({
    slug,
    name: `${slug} FC`,
    timeZone: 'Europe/Vienna',
    organizers: ['Org'],
    selfAliases: ['Я'],
    venues: [
        { key: 'north', name: 'North Arena', kind: 'training', patterns: ['north', 'норд'] },
        { key: 'park', name: 'Park Field', kind: 'training', patterns: ['park', 'парк'] }
    ],
    teamColors: [
        { emoji: '🟢', name: 'a-green' },
        { emoji: '🔵', name: 'b-blue' }
    ],
    squads: []
});

export const seedCommunity = Effect.fn('Testing.seedCommunity')(function* (config: CommunityConfig) {
    const db = yield* Db;
    const [row] = yield* db
        .insert(community)
        .values({ slug: config.slug, name: config.name, timezone: config.timeZone, settings: { ingest: config } })
        .returning({ id: community.id });
    const communityId = row?.id ?? '';
    const venues = yield* db
        .insert(venue)
        .values(config.venues.map(entry => ({ communityId, name: entry.name, kind: entry.kind })))
        .returning({ id: venue.id, name: venue.name });
    yield* db.insert(teamColor).values(config.teamColors.map(color => ({ communityId, name: color.name, emoji: color.emoji })));

    return { communityId, venueIdByName: new Map(venues.map(entry => [entry.name, entry.id])) };
});
