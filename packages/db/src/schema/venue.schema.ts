import { sql } from 'drizzle-orm';
import {
    boolean,
    check,
    doublePrecision,
    index,
    integer,
    uniqueIndex,
    jsonb,
    pgSchema,
    primaryKey,
    smallint,
    text,
    time
} from 'drizzle-orm/pg-core';

import { createdAt, id, instant, ref, tstzrange, updatedAt, requiredRef } from './columns';
import { person } from './identity.schema';
import { community } from './org.schema';

export const venueSchema = pgSchema('venue');

export const surfaceEnum = venueSchema.enum('surface', ['artificial_turf', 'grass', 'parquet', 'sand', 'hall_turf', 'asphalt', 'other']);
export const venueStatusEnum = venueSchema.enum('venue_status', ['active', 'inactive']);
export const bookingStatusEnum = venueSchema.enum('booking_status', ['held', 'confirmed', 'released']);
export const venueKindEnum = venueSchema.enum('venue_kind', ['training', 'league', 'tournament', 'social']);

export const venue = venueSchema.table(
    'venue',
    {
        id: id(),
        communityId: requiredRef('community_id', () => community.id),
        name: text('name').notNull(),
        shortName: text('short_name'),
        station: text('station'),
        kind: venueKindEnum('kind').notNull().default('training'),
        address: text('address'),
        district: smallint('district'),
        lat: doublePrecision('lat'),
        lng: doublePrecision('lng'),
        mapUrl: text('map_url'),
        transit: text('transit'),
        indoor: boolean('indoor'),
        parking: text('parking'),
        rules: text('rules'),
        cancellationPolicy: jsonb('cancellation_policy').notNull().default({}),
        hardEndLocal: time('hard_end_local'),
        status: venueStatusEnum('status').notNull().default('active'),
        createdAt: createdAt(),
        updatedAt: updatedAt()
    },
    t => [
        uniqueIndex('venue_community_name_uq').on(t.communityId, t.name),
        check('venue_lat_ck', sql`${t.lat} is null or ${t.lat} between -90 and 90`),
        check('venue_lng_ck', sql`${t.lng} is null or ${t.lng} between -180 and 180`),
        check('venue_district_ck', sql`${t.district} is null or ${t.district} between 1 and 23`)
    ]
);

export const venueAlias = venueSchema.table(
    'venue_alias',
    {
        venueId: requiredRef('venue_id', () => venue.id),
        aliasNorm: text('alias_norm').notNull()
    },
    t => [primaryKey({ columns: [t.venueId, t.aliasNorm] })]
);

export const field = venueSchema.table(
    'field',
    {
        id: id(),
        venueId: requiredRef('venue_id', () => venue.id),
        label: text('label').notNull(),
        surface: surfaceEnum('surface'),
        formatMax: smallint('format_max'),
        lengthM: integer('length_m'),
        widthM: integer('width_m'),
        indoor: boolean('indoor'),
        lit: boolean('lit')
    },
    t => [index('field_venue_idx').on(t.venueId)]
);

export const booking = venueSchema.table(
    'booking',
    {
        id: id(),
        fieldId: requiredRef('field_id', () => field.id, 'restrict'),
        during: tstzrange('during').notNull(),
        status: bookingStatusEnum('status').notNull().default('held'),
        costCents: integer('cost_cents'),
        cancelDeadline: instant('cancel_deadline'),
        bookedByPersonId: ref('booked_by_person_id').references(() => person.id, { onDelete: 'set null' }),
        externalRef: text('external_ref'),
        createdAt: createdAt()
    },
    t => [index('booking_field_idx').on(t.fieldId)]
);
