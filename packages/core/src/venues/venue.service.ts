import { isDefined, isNotEmptyArray, isNotEmptyString } from '@rnw-community/shared';
import { session } from '@rondo/db/schema/scheduling.schema';
import { venue, venueAlias } from '@rondo/db/schema/venue.schema';
import { Db } from '@rondo/db/service/db.service';
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { recordAudit } from '../audit/record-audit';
import { ActionFailedError } from '../error/action-failed.error';

import type { CommunityConfig } from '@rondo/ingest-telegram/config/community-config';

export interface VenueDetails {
    readonly shortName?: string;
    readonly station?: string;
    readonly address?: string;
    readonly district?: number;
    readonly indoor?: boolean;
    readonly lat?: number | null;
    readonly lng?: number | null;
}

export interface VenuePatch extends VenueDetails {
    readonly name?: string;
    readonly alias?: string;
    readonly active?: boolean;
}

const tidyVenueName = (value: string): string => value.trim().replaceAll(/\s+/gu, ' ');

const normalizeVenueName = (value: string): string => tidyVenueName(value).toLowerCase();

const escapePattern = (value: string): string => value.replaceAll(/[\\^$.*+?()[\]{}|/]/gu, String.raw`\$&`);

const aliasPattern = (value: string): string =>
    String.raw`(?<![\p{L}\p{N}])${escapePattern(value).replaceAll(' ', String.raw`\s+`)}(?![\p{L}\p{N}])`;

export const findVenueByName = Effect.fn('Core.findVenueByName')(function* (communityId: string, name: string) {
    const db = yield* Db;
    const wanted = normalizeVenueName(name);
    const [row] = yield* db
        .selectDistinct({ id: venue.id, name: venue.name, status: venue.status })
        .from(venue)
        .leftJoin(venueAlias, eq(venueAlias.venueId, venue.id))
        .where(
            and(
                eq(venue.communityId, communityId),
                sql`(lower(regexp_replace(trim(${venue.name}), '\\s+', ' ', 'g')) = ${wanted} or ${venueAlias.aliasNorm} = ${wanted})`
            )
        );

    return row ?? null;
});

export const withKnownVenues = Effect.fn('Core.withKnownVenues')(function* (communityId: string, config: CommunityConfig) {
    const db = yield* Db;
    const rows = yield* db
        .select({ id: venue.id, name: venue.name, kind: venue.kind, alias: venueAlias.aliasNorm })
        .from(venue)
        .leftJoin(venueAlias, eq(venueAlias.venueId, venue.id))
        .where(and(eq(venue.communityId, communityId), eq(venue.status, 'active')));
    const known = [...new Map(rows.map(row => [row.id, row])).values()].map(({ id, name, kind }) => ({
        key: id,
        name,
        kind,
        patterns: [name, ...rows.flatMap(row => (row.id === id && isNotEmptyString(row.alias) ? [row.alias] : []))].map(entry =>
            aliasPattern(normalizeVenueName(entry))
        )
    }));

    return { ...config, venues: [...config.venues, ...known] } satisfies CommunityConfig;
});

export const createVenue = Effect.fn('Core.createVenue')(function* (
    input: {
        readonly communityId: string;
        readonly name: string;
        readonly actorPersonId: string | null;
        readonly sessionId?: string | null;
    } & VenueDetails
) {
    const { communityId, actorPersonId, name, sessionId, ...details } = input;
    const db = yield* Db;

    const known = yield* findVenueByName(communityId, name);

    if (isDefined(known) || !isNotEmptyString(tidyVenueName(name))) {
        return yield* ActionFailedError.make({ reason: 'this venue already exists or has no name' });
    }

    return yield* db.transaction(() =>
        Effect.gen(function* () {
            const [created] = yield* db
                .insert(venue)
                .values({ communityId, name: tidyVenueName(name), ...details })
                .returning({ id: venue.id });
            const venueId = created?.id ?? '';

            if (isNotEmptyString(sessionId)) {
                yield* db
                    .update(session)
                    .set({ venueId })
                    .where(and(eq(session.id, sessionId), eq(session.communityId, communityId), isNull(session.venueId)));
            }

            yield* recordAudit({
                communityId,
                actorPersonId,
                action: 'venue.create',
                entityType: 'venue',
                entityId: venueId,
                diff: { name, ...details }
            });

            return venueId;
        })
    );
});

export const requireVenue = Effect.fn('Core.requireVenue')(function* (communityId: string, venueId: string) {
    const db = yield* Db;
    const [row] = yield* db
        .select({ id: venue.id, status: venue.status })
        .from(venue)
        .where(and(eq(venue.id, venueId), eq(venue.communityId, communityId)));

    return isDefined(row) ? row : yield* ActionFailedError.make({ reason: 'venue not found in this community' });
});

export const updateVenue = Effect.fn('Core.updateVenue')(function* (input: {
    readonly communityId: string;
    readonly venueId: string;
    readonly patch: VenuePatch;
    readonly actorPersonId: string | null;
}) {
    const db = yield* Db;
    const { alias, active, ...columns } = input.patch;
    const [before] = yield* db
        .select()
        .from(venue)
        .where(and(eq(venue.id, input.venueId), eq(venue.communityId, input.communityId)));

    if (!isDefined(before)) {
        return yield* ActionFailedError.make({ reason: 'venue not found in this community' });
    }

    for (const name of [columns.name, alias].filter(entry => isNotEmptyString(entry))) {
        const taken = yield* findVenueByName(input.communityId, name);

        if (isDefined(taken) && taken.id !== before.id) {
            return yield* ActionFailedError.make({ reason: 'another venue already has this name' });
        }
    }

    const aliases = [...(isNotEmptyString(columns.name) ? [before.name] : []), ...(isNotEmptyString(alias) ? [alias] : [])]
        .map(entry => normalizeVenueName(entry))
        .filter(entry => isNotEmptyString(entry));
    const status = isDefined(active) ? { status: active ? ('active' as const) : ('inactive' as const) } : {};
    const name = tidyVenueName(columns.name ?? before.name);

    if (!isNotEmptyString(name)) {
        return yield* ActionFailedError.make({ reason: 'the venue has no name' });
    }

    return yield* db.transaction(() =>
        Effect.gen(function* () {
            if (isNotEmptyArray(aliases)) {
                yield* db
                    .insert(venueAlias)
                    .values(aliases.map(aliasNorm => ({ venueId: before.id, aliasNorm })))
                    .onConflictDoNothing();
            }

            yield* db
                .update(venue)
                .set({ ...columns, name, ...status })
                .where(eq(venue.id, before.id));
            yield* recordAudit({
                communityId: input.communityId,
                actorPersonId: input.actorPersonId,
                action: 'venue.update',
                entityType: 'venue',
                entityId: before.id,
                diff: { before: { name: before.name, address: before.address, status: before.status }, patch: input.patch }
            });
        })
    );
});

export const learnVenuePin = Effect.fn('Core.learnVenuePin')(function* (input: {
    readonly communityId: string;
    readonly actorPersonId: string;
    readonly title: string;
    readonly address: string;
    readonly lat: number;
    readonly lng: number;
}) {
    const { communityId, actorPersonId, title, address, lat, lng } = input;
    const db = yield* Db;
    const known = yield* findVenueByName(communityId, title);

    if (!isDefined(known)) {
        return yield* createVenue({ communityId, actorPersonId, name: title, address, lat, lng });
    }
    yield* db
        .update(venue)
        .set({
            address: sql`coalesce(${venue.address}, ${address})`,
            lat: sql`coalesce(${venue.lat}, ${lat}::double precision)`,
            lng: sql`coalesce(${venue.lng}, ${lng}::double precision)`
        })
        .where(eq(venue.id, known.id));

    return known.id;
});
