import { bigint, boolean, index, integer, jsonb, numeric, pgSchema, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { createdAt, id, instant, ref, requiredRef } from './columns';
import { person } from './identity.schema';
import { community } from './org.schema';

export const comms = pgSchema('comms');
export const ingest = pgSchema('ingest');
export const audit = pgSchema('audit');

export const messagePurposeEnum = comms.enum('message_purpose', ['game_card', 'lineup', 'announcement', 'reminder', 'poll']);
export const channelEnum = comms.enum('channel', ['dm', 'group']);
export const ingestSourceEnum = ingest.enum('ingest_source', ['telegram_html', 'telegram_json']);
export const sourceRefKindEnum = ingest.enum('source_ref_kind', ['poll', 'lineup', 'cancel', 'result', 'price', 'service', 'message']);
export const actorKindEnum = audit.enum('actor_kind', ['user', 'bot', 'system']);

export const messageRef = comms.table(
    'message_ref',
    {
        chatId: bigint('chat_id', { mode: 'bigint' }).notNull(),
        messageId: bigint('message_id', { mode: 'number' }).notNull(),
        purpose: messagePurposeEnum('purpose').notNull(),
        entityType: text('entity_type').notNull(),
        entityId: ref('entity_id').notNull(),
        createdAt: createdAt()
    },
    t => [primaryKey({ columns: [t.chatId, t.messageId] }), index('message_ref_entity_idx').on(t.entityType, t.entityId)]
);

export const notificationPref = comms.table(
    'notification_pref',
    {
        personId: requiredRef('person_id', () => person.id),
        channel: channelEnum('channel').notNull(),
        kind: text('kind').notNull(),
        enabled: boolean('enabled').notNull().default(true)
    },
    t => [primaryKey({ columns: [t.personId, t.channel, t.kind] })]
);

export const outbox = comms.table(
    'outbox',
    {
        id: id(),
        aggregateType: text('aggregate_type').notNull(),
        aggregateId: ref('aggregate_id').notNull(),
        eventType: text('event_type').notNull(),
        payload: jsonb('payload').notNull(),
        createdAt: createdAt(),
        dispatchedAt: instant('dispatched_at'),
        attempts: integer('attempts').notNull().default(0)
    },
    t => [index('outbox_pending_idx').on(t.createdAt)]
);

export const ingestRun = ingest.table('run', {
    id: id(),
    communityId: requiredRef('community_id', () => community.id),
    source: ingestSourceEnum('source').notNull(),
    fileSha256: text('file_sha256').notNull(),
    parserVersion: text('parser_version').notNull(),
    startedAt: instant('started_at').notNull().defaultNow(),
    finishedAt: instant('finished_at'),
    stats: jsonb('stats').notNull().default({})
});

export const sourceRef = ingest.table(
    'source_ref',
    {
        id: id(),
        runId: requiredRef('run_id', () => ingestRun.id),
        communityId: requiredRef('community_id', () => community.id),
        messageId: bigint('message_id', { mode: 'number' }).notNull(),
        sentAt: instant('sent_at').notNull(),
        kind: sourceRefKindEnum('kind').notNull()
    },
    t => [uniqueIndex('source_ref_message_kind_uq').on(t.communityId, t.messageId, t.kind)]
);

export const extraction = ingest.table(
    'extraction',
    {
        id: id(),
        sourceRefId: requiredRef('source_ref_id', () => sourceRef.id),
        entityType: text('entity_type').notNull(),
        entityId: ref('entity_id').notNull(),
        confidence: numeric('confidence', { precision: 3, scale: 2, mode: 'number' })
    },
    t => [index('extraction_entity_idx').on(t.entityType, t.entityId)]
);

export const auditLog = audit.table(
    'log',
    {
        id: id(),
        at: instant('at').notNull().defaultNow(),
        actorPersonId: ref('actor_person_id').references(() => person.id, { onDelete: 'set null' }),
        actorKind: actorKindEnum('actor_kind').notNull(),
        communityId: ref('community_id'),
        action: text('action').notNull(),
        entityType: text('entity_type').notNull(),
        entityId: text('entity_id').notNull(),
        diff: jsonb('diff')
    },
    t => [index('audit_log_entity_idx').on(t.entityType, t.entityId), index('audit_log_at_idx').on(t.at)]
);
