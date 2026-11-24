import { priceRule } from '@rondo/db/schema/finance.schema';
import { person, personAlias, telegramAuthor } from '@rondo/db/schema/identity.schema';
import { fixture } from '@rondo/db/schema/league.schema';
import { activity, community } from '@rondo/db/schema/org.schema';
import { ingestRun } from '@rondo/db/schema/platform.schema';
import { teamColor } from '@rondo/db/schema/play.schema';
import { session } from '@rondo/db/schema/scheduling.schema';
import { venue } from '@rondo/db/schema/venue.schema';
import { and, eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import type { CommunityConfig } from '../config/community-config';
import type { LoadContext, ReferenceIds } from '../interface/load-context.interface';
import type { Transaction } from '../interface/transaction.type';

export const purgePreviousImport = Effect.fn('IngestTelegram.purgePreviousImport')(function* (
    transaction: Transaction,
    communityId: string
) {
    yield* transaction.delete(session).where(and(eq(session.communityId, communityId), eq(session.source, 'import')));
    yield* transaction
        .delete(fixture)
        .where(
            and(eq(fixture.source, 'import'), sql`${fixture.squadId} in (select id from league.squad where community_id = ${communityId})`)
        );
    yield* transaction.delete(priceRule).where(and(eq(priceRule.communityId, communityId), eq(priceRule.note, 'import')));
    yield* transaction
        .delete(person)
        .where(
            and(
                eq(person.source, 'import'),
                sql`${person.id} in (select person_id from identity.person_alias where community_id = ${communityId})`
            )
        );
    yield* transaction.delete(personAlias).where(eq(personAlias.communityId, communityId));
    yield* transaction.delete(telegramAuthor).where(eq(telegramAuthor.communityId, communityId));
    yield* transaction.delete(ingestRun).where(eq(ingestRun.communityId, communityId));
});

export const upsertCommunity = Effect.fn('IngestTelegram.upsertCommunity')(function* (transaction: Transaction, config: CommunityConfig) {
    const [row] = yield* transaction
        .insert(community)
        .values({ slug: config.slug, name: config.name, timezone: config.timeZone })
        .onConflictDoUpdate({ target: community.slug, set: { name: config.name, timezone: config.timeZone } })
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

    yield* transaction
        .insert(activity)
        .values(sports.map(sport => ({ communityId, sport, name: sport })))
        .onConflictDoNothing();
    const activities = yield* transaction.select().from(activity).where(eq(activity.communityId, communityId));

    yield* transaction.delete(venue).where(eq(venue.communityId, communityId));
    const venues = yield* transaction
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
        .returning({ id: venue.id, name: venue.name });
    const venueIdByKey = new Map(config.venues.map(configured => [configured.key, venues.find(row => row.name === configured.name)?.id]));

    yield* transaction
        .insert(teamColor)
        .values(config.teamColors.map(color => ({ communityId, name: color.name, emoji: color.emoji })))
        .onConflictDoNothing();
    const colors = yield* transaction.select().from(teamColor).where(eq(teamColor.communityId, communityId));

    return {
        activityIdBySport: new Map(activities.map(row => [row.sport, row.id])),
        venueIdByKey,
        colorIdByEmoji: new Map(colors.map(row => [row.emoji ?? '', row.id]))
    } satisfies ReferenceIds;
});
