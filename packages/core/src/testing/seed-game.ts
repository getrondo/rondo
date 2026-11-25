import * as Effect from 'effect/Effect';

import { createSession } from '../sessions/session.service';

import { seedCommunity, seedConfig } from './seed-community';

export const seedGame = Effect.fn('Testing.seedGame')(function* (slug: string, capacityMax: number | null = null) {
    const { communityId } = yield* seedCommunity(seedConfig(slug));
    const sessionId = yield* createSession({
        communityId,
        timezone: 'Europe/Vienna',
        localDate: '2026-12-04',
        localTime: '19:30',
        venueId: null,
        capacityMax,
        title: null,
        actorPersonId: null
    });

    return { communityId, sessionId };
});
