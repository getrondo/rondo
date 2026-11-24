import { index, integer, pgSchema, primaryKey, smallint, text } from 'drizzle-orm/pg-core';

import { createdAt, id, instant, ref, tstzrange, requiredRef } from './columns';
import { person } from './identity.schema';
import { community as communityTable } from './org.schema';
import { teamColor } from './play.schema';
import { session } from './scheduling.schema';
import { venue } from './venue.schema';

export const communitySchema = pgSchema('community');

export const eventKindEnum = communitySchema.enum('event_kind', ['bbq', 'watch_party', 'trip', 'ceremony', 'other']);
export const equipmentKindEnum = communitySchema.enum('equipment_kind', ['bib_set', 'ball', 'pump', 'goal', 'other']);
export const lostItemStatusEnum = communitySchema.enum('lost_item_status', ['found', 'claimed', 'discarded']);
export const adStatusEnum = communitySchema.enum('ad_status', ['pending', 'approved', 'rejected', 'posted']);

export const event = communitySchema.table(
    'event',
    {
        id: id(),
        communityId: requiredRef('community_id', () => communityTable.id),
        kind: eventKindEnum('kind').notNull(),
        title: text('title').notNull(),
        startsAt: instant('starts_at').notNull(),
        venueId: ref('venue_id').references(() => venue.id, { onDelete: 'set null' }),
        capacity: smallint('capacity'),
        createdAt: createdAt()
    },
    t => [index('event_community_idx').on(t.communityId, t.startsAt)]
);

export const eventRsvp = communitySchema.table(
    'event_rsvp',
    {
        eventId: requiredRef('event_id', () => event.id),
        personId: requiredRef('person_id', () => person.id),
        guests: smallint('guests').notNull().default(0),
        kids: smallint('kids').notNull().default(0)
    },
    t => [primaryKey({ columns: [t.eventId, t.personId] })]
);

export const ruleDoc = communitySchema.table('rule_doc', {
    id: id(),
    communityId: requiredRef('community_id', () => communityTable.id),
    topic: text('topic').notNull(),
    version: integer('version').notNull(),
    bodyMd: text('body_md').notNull(),
    effectiveFrom: instant('effective_from').notNull(),
    createdAt: createdAt()
});

export const ruleAck = communitySchema.table(
    'rule_ack',
    {
        ruleDocId: requiredRef('rule_doc_id', () => ruleDoc.id),
        personId: requiredRef('person_id', () => person.id),
        at: instant('at').notNull().defaultNow()
    },
    t => [primaryKey({ columns: [t.ruleDocId, t.personId] })]
);

export const equipment = communitySchema.table('equipment', {
    id: id(),
    communityId: requiredRef('community_id', () => communityTable.id),
    kind: equipmentKindEnum('kind').notNull(),
    label: text('label').notNull(),
    colorId: ref('color_id').references(() => teamColor.id, { onDelete: 'set null' }),
    quantity: smallint('quantity').notNull().default(1)
});

export const equipmentCustody = communitySchema.table('equipment_custody', {
    id: id(),
    equipmentId: requiredRef('equipment_id', () => equipment.id),
    personId: requiredRef('person_id', () => person.id),
    during: tstzrange('during').notNull()
});

export const lostItem = communitySchema.table('lost_item', {
    id: id(),
    communityId: requiredRef('community_id', () => communityTable.id),
    sessionId: ref('session_id').references(() => session.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    photoFileId: text('photo_file_id'),
    status: lostItemStatusEnum('status').notNull().default('found'),
    createdAt: createdAt()
});

export const ad = communitySchema.table('ad', {
    id: id(),
    communityId: requiredRef('community_id', () => communityTable.id),
    authorId: requiredRef('author_id', () => person.id),
    body: text('body').notNull(),
    status: adStatusEnum('status').notNull().default('pending'),
    feeTxnId: ref('fee_txn_id'),
    createdAt: createdAt()
});
