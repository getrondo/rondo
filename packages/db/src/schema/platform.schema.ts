import { sql } from 'drizzle-orm';
import { bigint, index, integer, jsonb, numeric, pgSchema, primaryKey, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, id, instant, ref, requiredRef } from './columns';
import { person, telegramAccount } from './identity.schema';
import { community } from './org.schema';
import { session } from './scheduling.schema';

export const comms = pgSchema('comms');
export const ingest = pgSchema('ingest');
export const audit = pgSchema('audit');

export const messagePurposeEnum = comms.enum('message_purpose', ['game_card', 'lineup', 'announcement', 'reminder', 'poll']);
export const importedPollKindEnum = comms.enum('imported_poll_kind', ['participation', 'reserve', 'other']);
export const ingestSourceEnum = ingest.enum('ingest_source', ['telegram_html', 'telegram_json']);
export const sourceRefKindEnum = ingest.enum('source_ref_kind', ['poll', 'lineup', 'cancel', 'result', 'price', 'service', 'message']);
export const actorKindEnum = audit.enum('actor_kind', ['user', 'bot', 'system']);
export const assistantRoleEnum = comms.enum('assistant_role', ['user', 'assistant']);
export const pendingActionStatusEnum = comms.enum('pending_action_status', ['proposed', 'confirmed', 'rejected', 'expired', 'failed']);

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

export const telegramPoll = comms.table(
    'telegram_poll',
    {
        pollId: text('poll_id').primaryKey(),
        chatId: bigint('chat_id', { mode: 'bigint' }).notNull(),
        messageId: bigint('message_id', { mode: 'number' }).notNull(),
        sessionId: requiredRef('session_id', () => session.id),
        options: jsonb('options').$type<readonly string[]>().notNull(),
        closedAt: instant('closed_at'),
        createdAt: createdAt()
    },
    t => [index('telegram_poll_session_idx').on(t.sessionId)]
);

export const pollForward = comms.table(
    'poll_forward',
    {
        pollId: text('poll_id')
            .notNull()
            .references(() => telegramPoll.pollId, { onDelete: 'cascade' }),
        chatId: bigint('chat_id', { mode: 'bigint' }).notNull(),
        messageId: bigint('message_id', { mode: 'number' }),
        topicId: bigint('topic_id', { mode: 'number' }),
        token: uuid('token').notNull().defaultRandom(),
        claimedAt: instant('claimed_at').notNull().defaultNow()
    },
    t => [primaryKey({ columns: [t.pollId, t.chatId] })]
);

export const importedPoll = comms.table(
    'imported_poll',
    {
        pollId: text('poll_id').primaryKey(),
        communityId: requiredRef('community_id', () => community.id),
        sessionId: ref('session_id').references(() => session.id, { onDelete: 'set null' }),
        chatId: bigint('chat_id', { mode: 'number' }),
        messageId: bigint('message_id', { mode: 'number' }).notNull(),
        postedAt: instant('posted_at').notNull(),
        kind: importedPollKindEnum('kind').notNull(),
        answers: smallint('answers').notNull()
    },
    t => [index('imported_poll_session_idx').on(t.sessionId), index('imported_poll_community_idx').on(t.communityId)]
);

export const pollVote = comms.table(
    'poll_vote',
    {
        pollId: text('poll_id').notNull(),
        tgUserId: bigint('tg_user_id', { mode: 'bigint' })
            .notNull()
            .references(() => telegramAccount.tgUserId, { onDelete: 'cascade' }),
        sessionId: ref('session_id').references(() => session.id, { onDelete: 'set null' }),
        choice: text('choice').notNull(),
        votedAt: instant('voted_at')
    },
    t => [primaryKey({ columns: [t.pollId, t.tgUserId] }), index('poll_vote_session_idx').on(t.sessionId)]
);

export const processedUpdate = comms.table('processed_update', {
    updateId: bigint('update_id', { mode: 'number' }).primaryKey(),
    attempts: integer('attempts').notNull().default(1),
    doneAt: instant('done_at'),
    at: instant('at').notNull().defaultNow()
});

export const assistantMessage = comms.table(
    'assistant_message',
    {
        id: id(),
        tgUserId: bigint('tg_user_id', { mode: 'bigint' }).notNull(),
        role: assistantRoleEnum('role').notNull(),
        content: text('content').notNull(),
        at: instant('at').notNull().defaultNow()
    },
    t => [index('assistant_message_user_idx').on(t.tgUserId, t.at)]
);

export const pendingAction = comms.table(
    'pending_action',
    {
        id: id(),
        communityId: requiredRef('community_id', () => community.id),
        requestedByTgUserId: bigint('requested_by_tg_user_id', { mode: 'bigint' }).notNull(),
        approverTgUserId: bigint('approver_tg_user_id', { mode: 'bigint' }),
        kind: text('kind').notNull(),
        payload: jsonb('payload').notNull(),
        summary: text('summary').notNull(),
        status: pendingActionStatusEnum('status').notNull().default('proposed'),
        result: jsonb('result'),
        createdAt: createdAt(),
        expiresAt: instant('expires_at').notNull(),
        decidedAt: instant('decided_at')
    },
    t => [index('pending_action_status_idx').on(t.status, t.expiresAt)]
);

export const adminState = comms.table('admin_state', {
    tgUserId: bigint('tg_user_id', { mode: 'bigint' }).primaryKey(),
    communityId: requiredRef('community_id', () => community.id),
    messageId: bigint('message_id', { mode: 'number' }),
    revision: integer('revision').notNull().default(0),
    awaiting: text('awaiting'),
    draft: jsonb('draft').notNull().default({}),
    expiresAt: instant('expires_at').notNull()
});

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
        chatId: bigint('chat_id', { mode: 'number' }),
        messageId: bigint('message_id', { mode: 'number' }).notNull(),
        sentAt: instant('sent_at').notNull(),
        kind: sourceRefKindEnum('kind').notNull()
    },
    t => [uniqueIndex('source_ref_message_kind_uq').on(t.communityId, sql`coalesce(${t.chatId}, 0)`, t.messageId, t.kind)]
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
