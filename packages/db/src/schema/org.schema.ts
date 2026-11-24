import { sql } from 'drizzle-orm';
import { bigint, index, jsonb, pgSchema, primaryKey, smallint, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { createdAt, id, instant, ref, tstzrange, updatedAt, requiredRef } from './columns';
import { localeEnum, person } from './identity.schema';

export const org = pgSchema('org');

export const chatKindEnum = org.enum('chat_kind', ['group', 'supergroup', 'channel', 'private']);
export const chatPurposeEnum = org.enum('chat_purpose', ['main', 'activity', 'squad', 'staff']);
export const membershipStatusEnum = org.enum('membership_status', ['active', 'left', 'removed']);
export const roleEnum = org.enum('role', ['owner', 'organizer', 'helper', 'scorekeeper', 'manager']);
export const scopeTypeEnum = org.enum('scope_type', ['community', 'activity', 'squad', 'session']);
export const sportEnum = org.enum('sport', [
    'football',
    'futsal',
    'basketball',
    'volleyball',
    'beach_volleyball',
    'table_tennis',
    'boxing',
    'other'
]);
export const notifyLevelEnum = org.enum('notify_level', ['all', 'reminders', 'none']);
export const positionEnum = org.enum('position', ['gk', 'def', 'mid', 'fwd', 'any']);
export const footEnum = org.enum('foot', ['left', 'right', 'both']);

export const community = org.table('community', {
    id: id(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('Europe/Vienna'),
    currency: text('currency').notNull().default('EUR'),
    defaultLocale: localeEnum('default_locale').notNull().default('uk'),
    settings: jsonb('settings').notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt()
});

export const activity = org.table(
    'activity',
    {
        id: id(),
        communityId: requiredRef('community_id', () => community.id),
        sport: sportEnum('sport').notNull(),
        name: text('name').notNull(),
        defaults: jsonb('defaults').notNull().default({}),
        createdAt: createdAt()
    },
    t => [uniqueIndex('activity_name_uq').on(t.communityId, t.name)]
);

export const telegramChat = org.table(
    'telegram_chat',
    {
        chatId: bigint('chat_id', { mode: 'bigint' }).primaryKey(),
        communityId: requiredRef('community_id', () => community.id),
        activityId: ref('activity_id').references(() => activity.id, { onDelete: 'set null' }),
        kind: chatKindEnum('kind').notNull(),
        purpose: chatPurposeEnum('purpose').notNull().default('main'),
        title: text('title').notNull(),
        topicId: bigint('topic_id', { mode: 'number' }),
        botRights: jsonb('bot_rights').notNull().default({}),
        createdAt: createdAt()
    },
    t => [index('telegram_chat_community_idx').on(t.communityId)]
);

export const membership = org.table(
    'membership',
    {
        communityId: requiredRef('community_id', () => community.id),
        personId: requiredRef('person_id', () => person.id),
        status: membershipStatusEnum('status').notNull().default('active'),
        joinedAt: instant('joined_at'),
        leftAt: instant('left_at'),
        invitedByPersonId: ref('invited_by_person_id').references(() => person.id, { onDelete: 'set null' }),
        sponsorPersonId: ref('sponsor_person_id').references(() => person.id, { onDelete: 'set null' })
    },
    t => [primaryKey({ columns: [t.communityId, t.personId] })]
);

export const roleGrant = org.table(
    'role_grant',
    {
        id: id(),
        communityId: requiredRef('community_id', () => community.id),
        personId: requiredRef('person_id', () => person.id),
        role: roleEnum('role').notNull(),
        scopeType: scopeTypeEnum('scope_type').notNull().default('community'),
        scopeId: ref('scope_id'),
        valid: tstzrange('valid')
            .notNull()
            .default(sql`'(,)'`),
        grantedBy: ref('granted_by').references(() => person.id, { onDelete: 'set null' }),
        createdAt: createdAt()
    },
    t => [index('role_grant_person_idx').on(t.communityId, t.personId)]
);

export const activityFollow = org.table(
    'activity_follow',
    {
        personId: requiredRef('person_id', () => person.id),
        activityId: requiredRef('activity_id', () => activity.id),
        notify: notifyLevelEnum('notify').notNull().default('all')
    },
    t => [primaryKey({ columns: [t.personId, t.activityId] })]
);

export const playerProfile = org.table(
    'player_profile',
    {
        personId: requiredRef('person_id', () => person.id),
        activityId: requiredRef('activity_id', () => activity.id),
        positions: positionEnum('positions').array().notNull().default([]),
        preferredFoot: footEnum('preferred_foot'),
        selfLevel: smallint('self_level'),
        updatedAt: updatedAt()
    },
    t => [primaryKey({ columns: [t.personId, t.activityId] })]
);
