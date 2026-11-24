import { expect, layer } from '@effect/vitest';
import { sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';

import { account, ledgerEntry, ledgerTxn, priceRule } from '../src/schema/finance.schema';
import { community } from '../src/schema/org.schema';
import { booking, field, venue } from '../src/schema/venue.schema';
import { Db } from '../src/service/db.service';
import { testDbLayer } from '../src/testing/test-db.layer';

const seedCommunity = Effect.fn('test.seedCommunity')(function* (slug: string) {
    const db = yield* Db;
    const [row] = yield* db.insert(community).values({ slug, name: slug }).returning({ id: community.id });

    return row?.id ?? '';
});

const postTxn = Effect.fn('test.postTxn')(function* (
    communityId: string,
    entries: readonly { accountId: string | undefined; amountCents: number }[]
) {
    const db = yield* Db;

    return yield* Effect.exit(
        db.transaction(tx =>
            Effect.gen(function* () {
                const [txn] = yield* tx
                    .insert(ledgerTxn)
                    .values({ communityId, occurredAt: new Date(), kind: 'payment' })
                    .returning({ id: ledgerTxn.id });
                yield* tx
                    .insert(ledgerEntry)
                    .values(
                        entries.map(entry => ({ txnId: txn?.id ?? '', accountId: entry.accountId ?? '', amountCents: entry.amountCents }))
                    );
            })
        )
    );
});

layer(testDbLayer, { timeout: 60_000 })('database invariants', it => {
    it.effect('rejects overlapping bookings on the same field', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const communityId = yield* seedCommunity('bookings');
            const [venueRow] = yield* db.insert(venue).values({ communityId, name: 'Arena' }).returning({ id: venue.id });
            const [fieldRow] = yield* db
                .insert(field)
                .values({ venueId: venueRow?.id ?? '', label: '1' })
                .returning({ id: field.id });
            const fieldId = fieldRow?.id ?? '';

            yield* db.insert(booking).values({ fieldId, during: '[2026-01-05 18:00+00,2026-01-05 19:30+00)', status: 'confirmed' });
            const overlap = yield* Effect.exit(
                db.insert(booking).values({ fieldId, during: '[2026-01-05 19:00+00,2026-01-05 20:00+00)', status: 'confirmed' })
            );
            const released = yield* Effect.exit(
                db.insert(booking).values({ fieldId, during: '[2026-01-05 19:00+00,2026-01-05 20:00+00)', status: 'released' })
            );

            expect(Exit.isFailure(overlap)).toBe(true);
            expect(Exit.isSuccess(released)).toBe(true);
        })
    );

    it.effect('accepts balanced ledger transactions and rejects unbalanced ones', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const communityId = yield* seedCommunity('ledger');
            const [receivable, cash] = yield* db
                .insert(account)
                .values([
                    { communityId, kind: 'player_receivable', name: 'Player' },
                    { communityId, kind: 'cash_box', name: 'Cash' }
                ])
                .returning({ id: account.id });
            const post = (amounts: readonly number[]) =>
                postTxn(communityId, [
                    { accountId: receivable?.id, amountCents: amounts[0] ?? 0 },
                    { accountId: cash?.id, amountCents: amounts[1] ?? 0 }
                ]);

            expect(Exit.isSuccess(yield* post([-1000, 1000]))).toBe(true);
            expect(Exit.isFailure(yield* post([-1000, 900]))).toBe(true);
        })
    );

    it.effect('rejects ledger transactions across communities or currencies', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const communityId = yield* seedCommunity('ledger-home');
            const otherId = yield* seedCommunity('ledger-other');
            const [home, sameCurrency, otherCurrency, foreign] = yield* db
                .insert(account)
                .values([
                    { communityId, kind: 'player_receivable', name: 'Home' },
                    { communityId, kind: 'cash_box', name: 'Cash' },
                    { communityId, kind: 'organizer_bank', name: 'Dollars', currency: 'USD' },
                    { communityId: otherId, kind: 'cash_box', name: 'Foreign' }
                ])
                .returning({ id: account.id });
            const post = (credit: string | undefined) =>
                postTxn(communityId, [
                    { accountId: home?.id, amountCents: -500 },
                    { accountId: credit, amountCents: 500 }
                ]);

            expect(Exit.isSuccess(yield* post(sameCurrency?.id))).toBe(true);
            expect(Exit.isFailure(yield* post(foreign?.id))).toBe(true);
            expect(Exit.isFailure(yield* post(otherCurrency?.id))).toBe(true);
        })
    );

    it.effect('rejects price rules with an empty headcount range', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const communityId = yield* seedCommunity('prices');
            const insert = (headcount: string | null) =>
                Effect.exit(
                    db.insert(priceRule).values({ communityId, scope: 'community', amountCents: 800, headcount, valid: '[2026-01-01,)' })
                );

            expect(Exit.isFailure(yield* insert('empty'))).toBe(true);
            expect(Exit.isSuccess(yield* insert('[8,12]'))).toBe(true);
        })
    );

    it.effect('keeps ledger entries append-only', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const update = yield* Effect.exit(db.execute(sql`update finance.ledger_entry set amount_cents = amount_cents * 2`));
            const rows = yield* db.select().from(ledgerEntry);

            expect(rows.length).toBeGreaterThan(0);
            expect(Exit.isFailure(update)).toBe(true);
        })
    );
});
