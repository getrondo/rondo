import { isDefined, isNotEmptyArray } from '@rnw-community/shared';
import { priceRule } from '@rondo/db/schema/finance.schema';
import { fixture } from '@rondo/db/schema/league.schema';
import { activity, community } from '@rondo/db/schema/org.schema';
import { teamColor } from '@rondo/db/schema/play.schema';
import { venue } from '@rondo/db/schema/venue.schema';
import { and, eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { DuplicateVenueNameError } from '../error/duplicate-venue-name.error';

import type { CommunityConfig } from '../config/community-config';
import type { LoadContext, ReferenceIds } from '../interface/load-context.interface';
import type { Transaction } from '../interface/transaction.type';

export const assertUniqueVenueNames = (config: CommunityConfig): Effect.Effect<void, DuplicateVenueNameError> => {
    const keysByName = new Map<string, string[]>();

    for (const { name, key } of config.venues) {
        keysByName.set(name, [...(keysByName.get(name) ?? []), key]);
    }

    const duplicate = keysByName.entries().find(([, keys]) => keys.length > 1);

    return isDefined(duplicate) ? Effect.fail(DuplicateVenueNameError.make({ venueName: duplicate[0], keys: duplicate[1] })) : Effect.void;
};

export const purgePreviousImport = Effect.fn('IngestTelegram.purgePreviousImport')(function* (
    transaction: Transaction,
    communityId: string
) {
    yield* transaction
        .delete(fixture)
        .where(
            and(eq(fixture.source, 'import'), sql`${fixture.squadId} in (select id from league.squad where community_id = ${communityId})`)
        );
    yield* transaction.delete(priceRule).where(and(eq(priceRule.communityId, communityId), eq(priceRule.note, 'import')));
});

export const upsertCommunity = Effect.fn('IngestTelegram.upsertCommunity')(function* (transaction: Transaction, config: CommunityConfig) {
    const [row] = yield* transaction
        .insert(community)
        .values({ slug: config.slug, name: config.name, timezone: config.timeZone, settings: { ingest: config } })
        .onConflictDoUpdate({
            target: community.slug,
            set: {
                name: config.name,
                timezone: config.timeZone,
                settings: sql`${community.settings} || jsonb_build_object('ingest', ${JSON.stringify(config)}::jsonb)`
            }
        })
        .returning({ id: community.id });

    return row?.id ?? '';
});

export const upsertReference = Effect.fn('IngestTelegram.upsertReference')(function* ({
    transaction,
    communityId,
    config,
    plan
}: LoadContext) {
    const sports = [...new Set(plan.sessions.map(planned => planned.sport))];

    if (isNotEmptyArray(sports)) {
        yield* transaction
            .insert(activity)
            .values(sports.map(sport => ({ communityId, sport, name: sport })))
            .onConflictDoNothing();
    }

    const activities = yield* transaction.select().from(activity).where(eq(activity.communityId, communityId));

    const venues = isNotEmptyArray(config.venues)
        ? yield* transaction
              .insert(venue)
              .values(
                  config.venues.map(configured => ({
                      communityId,
                      name: configured.name,
                      kind: configured.kind,
                      district: configured.district,
                      lat: configured.lat,
                      lng: configured.lng,
                      indoor: configured.indoor,
                      transit: configured.transit
                  }))
              )
              .onConflictDoUpdate({
                  target: [venue.communityId, venue.name],
                  set: {
                      district: sql`coalesce(${venue.district}, excluded.district)`,
                      lat: sql`coalesce(${venue.lat}, excluded.lat)`,
                      lng: sql`coalesce(${venue.lng}, excluded.lng)`,
                      indoor: sql`coalesce(${venue.indoor}, excluded.indoor)`,
                      transit: sql`coalesce(${venue.transit}, excluded.transit)`
                  }
              })
              .returning({ id: venue.id, name: venue.name })
        : [];
    const venueIdByKey = new Map(config.venues.map(configured => [configured.key, venues.find(row => row.name === configured.name)?.id]));

    if (isNotEmptyArray(config.teamColors)) {
        yield* transaction
            .insert(teamColor)
            .values(config.teamColors.map(color => ({ communityId, name: color.name, emoji: color.emoji })))
            .onConflictDoNothing();
    }

    const colors = yield* transaction.select().from(teamColor).where(eq(teamColor.communityId, communityId));

    return {
        activityIdBySport: new Map(activities.map(row => [row.sport, row.id])),
        venueIdByKey,
        colorIdByEmoji: new Map(colors.map(row => [row.emoji ?? '', row.id]))
    } satisfies ReferenceIds;
});
