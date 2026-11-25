import { sql } from 'drizzle-orm';
import { bigint, date, index, numeric, pgSchema, text, uniqueIndex, integer, type AnyPgColumn } from 'drizzle-orm/pg-core';

import { createdAt, daterange, id, instant, ref, updatedAt, requiredRef } from './columns';

export const identity = pgSchema('identity');

export const localeEnum = identity.enum('locale', ['uk', 'ru', 'en', 'de']);
export const aliasKindEnum = identity.enum('alias_kind', ['nickname', 'first_name', 'full_name', 'placeholder', 'self']);
export const aliasResolutionEnum = identity.enum('alias_resolution', ['unresolved', 'suggested', 'confirmed', 'guest', 'ignored', 'vote']);
export const aliasLinkMethodEnum = identity.enum('alias_link_method', ['admin', 'owner_list']);
export const aliasLinkStatusEnum = identity.enum('alias_link_status', ['approved', 'rejected']);
export const recordSourceEnum = identity.enum('record_source', ['bot', 'import', 'manual']);

export const person = identity.table('person', {
    id: id(),
    displayName: text('display_name').notNull(),
    locale: localeEnum('locale').notNull().default('uk'),
    birthDate: date('birth_date', { mode: 'string' }),
    source: recordSourceEnum('source').notNull().default('bot'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    anonymizedAt: instant('anonymized_at'),
    mergedIntoPersonId: ref('merged_into_person_id').references((): AnyPgColumn => person.id, { onDelete: 'set null' })
});

export const telegramAccount = identity.table(
    'telegram_account',
    {
        tgUserId: bigint('tg_user_id', { mode: 'bigint' }).primaryKey(),
        personId: ref('person_id').references(() => person.id, { onDelete: 'set null' }),
        username: text('username'),
        firstName: text('first_name').notNull(),
        lastName: text('last_name'),
        languageCode: text('language_code'),
        firstSeenAt: instant('first_seen_at').notNull().defaultNow(),
        lastSeenAt: instant('last_seen_at').notNull().defaultNow()
    },
    t => [
        index('telegram_account_person_idx').on(t.personId),
        uniqueIndex('telegram_account_username_uq')
            .on(sql`lower(${t.username})`)
            .where(sql`${t.username} is not null`)
    ]
);

export const telegramAuthor = identity.table(
    'telegram_author',
    {
        id: id(),
        communityId: ref('community_id').notNull(),
        displayName: text('display_name').notNull(),
        tgUserId: bigint('tg_user_id', { mode: 'bigint' }),
        personId: ref('person_id').references(() => person.id, { onDelete: 'set null' }),
        messageCount: integer('message_count').notNull().default(0),
        firstSeenAt: instant('first_seen_at').notNull(),
        lastSeenAt: instant('last_seen_at').notNull()
    },
    t => [uniqueIndex('telegram_author_name_uq').on(t.communityId, t.displayName)]
);

export const personAlias = identity.table(
    'person_alias',
    {
        id: id(),
        communityId: ref('community_id').notNull(),
        personId: ref('person_id').references(() => person.id, { onDelete: 'set null' }),
        guestPersonId: ref('guest_person_id').references(() => person.id, { onDelete: 'set null' }),
        alias: text('alias').notNull(),
        aliasNorm: text('alias_norm').notNull(),
        kind: aliasKindEnum('kind').notNull().default('nickname'),
        occurrences: integer('occurrences').notNull().default(0),
        firstSeenAt: instant('first_seen_at'),
        lastSeenAt: instant('last_seen_at'),
        resolution: aliasResolutionEnum('resolution').notNull().default('unresolved'),
        // Unused: the previous release reads and writes it, a later migration drops it
        confidence: numeric('confidence', { precision: 3, scale: 2, mode: 'number' }),
        createdAt: createdAt()
    },
    t => [uniqueIndex('person_alias_norm_uq').on(t.communityId, t.aliasNorm), index('person_alias_person_idx').on(t.personId)]
);

export const aliasLink = identity.table(
    'alias_link',
    {
        id: id(),
        communityId: ref('community_id').notNull(),
        aliasId: requiredRef('alias_id', () => personAlias.id),
        personId: requiredRef('person_id', () => person.id),
        during: daterange('during').notNull(),
        method: aliasLinkMethodEnum('method').notNull(),
        status: aliasLinkStatusEnum('status').notNull(),
        decidedBy: ref('decided_by').references(() => person.id, { onDelete: 'set null' }),
        decidedAt: instant('decided_at')
    },
    t => [index('alias_link_alias_idx').on(t.aliasId), index('alias_link_person_idx').on(t.personId)]
);
