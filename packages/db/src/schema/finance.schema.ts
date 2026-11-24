import { sql } from 'drizzle-orm';
import { bigint, check, index, pgSchema, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { createdAt, daterange, id, instant, int4range, ref, requiredRef } from './columns';
import { person } from './identity.schema';
import { community } from './org.schema';
import { session } from './scheduling.schema';

export const finance = pgSchema('finance');

export const accountKindEnum = finance.enum('account_kind', [
    'player_receivable',
    'cash_box',
    'organizer_bank',
    'venue_payable',
    'income',
    'expense',
    'prize_fund'
]);
export const priceScopeEnum = finance.enum('price_scope', ['community', 'activity', 'series', 'venue', 'session']);
export const priceAppliesToEnum = finance.enum('price_applies_to', ['field', 'gk', 'guest', 'hall_of_fame']);
export const txnKindEnum = finance.enum('txn_kind', [
    'session_fee',
    'late_cancel_fee',
    'no_show_fee',
    'payment',
    'venue_cost',
    'event_split',
    'prize',
    'adjustment'
]);
export const paymentMethodEnum = finance.enum('payment_method', ['cash', 'sepa', 'other']);

export const account = finance.table(
    'account',
    {
        id: id(),
        communityId: requiredRef('community_id', () => community.id),
        kind: accountKindEnum('kind').notNull(),
        personId: ref('person_id').references(() => person.id, { onDelete: 'restrict' }),
        name: text('name').notNull(),
        currency: text('currency').notNull().default('EUR'),
        createdAt: createdAt()
    },
    t => [uniqueIndex('account_person_kind_uq').on(t.communityId, t.kind, t.personId)]
);

export const priceRule = finance.table(
    'price_rule',
    {
        id: id(),
        communityId: requiredRef('community_id', () => community.id),
        scope: priceScopeEnum('scope').notNull(),
        scopeId: ref('scope_id'),
        appliesTo: priceAppliesToEnum('applies_to').notNull().default('field'),
        amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
        headcount: int4range('headcount'),
        valid: daterange('valid').notNull(),
        note: text('note'),
        createdAt: createdAt()
    },
    t => [check('price_rule_amount_ck', sql`${t.amountCents} >= 0`)]
);

export const ledgerTxn = finance.table(
    'ledger_txn',
    {
        id: id(),
        communityId: requiredRef('community_id', () => community.id),
        occurredAt: instant('occurred_at').notNull(),
        kind: txnKindEnum('kind').notNull(),
        sessionId: ref('session_id').references(() => session.id, { onDelete: 'set null' }),
        eventId: ref('event_id'),
        memo: text('memo'),
        createdBy: ref('created_by').references(() => person.id, { onDelete: 'set null' }),
        approvedBy: ref('approved_by').references(() => person.id, { onDelete: 'set null' }),
        reversesTxnId: ref('reverses_txn_id'),
        createdAt: createdAt()
    },
    t => [index('ledger_txn_session_idx').on(t.sessionId), index('ledger_txn_occurred_idx').on(t.communityId, t.occurredAt)]
);

export const ledgerEntry = finance.table(
    'ledger_entry',
    {
        id: id(),
        txnId: requiredRef('txn_id', () => ledgerTxn.id, 'restrict'),
        accountId: requiredRef('account_id', () => account.id, 'restrict'),
        amountCents: bigint('amount_cents', { mode: 'number' }).notNull()
    },
    t => [
        index('ledger_entry_account_idx').on(t.accountId),
        index('ledger_entry_txn_idx').on(t.txnId),
        check('ledger_entry_nonzero_ck', sql`${t.amountCents} <> 0`)
    ]
);

export const payment = finance.table('payment', {
    txnId: ref('txn_id')
        .primaryKey()
        .references(() => ledgerTxn.id, { onDelete: 'restrict' }),
    payerPersonId: requiredRef('payer_person_id', () => person.id, 'restrict'),
    method: paymentMethodEnum('method').notNull(),
    collectedByPersonId: ref('collected_by_person_id').references(() => person.id, { onDelete: 'set null' }),
    confirmedBy: ref('confirmed_by').references(() => person.id, { onDelete: 'set null' }),
    confirmedAt: instant('confirmed_at')
});
