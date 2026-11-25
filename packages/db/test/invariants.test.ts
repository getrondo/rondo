import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, layer } from '@effect/vitest';
import { eq, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';

import { account, ledgerEntry, ledgerTxn, priceRule } from '../src/schema/finance.schema';
import { aliasLink, person, personAlias, telegramAccount } from '../src/schema/identity.schema';
import { activity, community } from '../src/schema/org.schema';
import { auditLog } from '../src/schema/platform.schema';
import { team, teamColor } from '../src/schema/play.schema';
import { session, signup, signupEvent } from '../src/schema/scheduling.schema';
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

    it.effect('keeps the newest of several accounts with one username when the unique index is created', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const file = fileURLToPath(new URL('../drizzle/20261124175907_telegram_identity/migration.sql', import.meta.url));
            const statements = readFileSync(file, 'utf8')
                .split('--> statement-breakpoint')
                .filter(statement => statement.includes('"username"'));
            yield* db.execute(sql`drop index identity.telegram_account_username_uq`);
            yield* db.insert(telegramAccount).values([
                { tgUserId: 1n, firstName: 'Old', username: 'Striker', lastSeenAt: new Date('2025-01-01T00:00:00Z') },
                { tgUserId: 2n, firstName: 'New', username: 'striker', lastSeenAt: new Date('2025-02-01T00:00:00Z') },
                { tgUserId: 3n, firstName: 'Same', username: 'STRIKER', lastSeenAt: new Date('2025-02-01T00:00:00Z') },
                { tgUserId: 4n, firstName: 'Other', username: 'keeper' }
            ]);
            const outcome = yield* Effect.exit(Effect.all(statements.map(statement => db.execute(sql.raw(statement)))));
            const rows = yield* db.select().from(telegramAccount).orderBy(telegramAccount.tgUserId);

            expect(Exit.isSuccess(outcome)).toBe(true);
            expect(rows.map(({ username }) => username)).toEqual([null, null, 'STRIKER', 'keeper']);
        })
    );

    it.effect('turns existing links into decisions, also again for links changed meanwhile, and forbids overlapping ones', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const communityId = yield* seedCommunity('decisions');
            const people = yield* db
                .insert(person)
                .values(['Guest', 'Linked', 'Undone'].map(displayName => ({ displayName })))
                .returning({ id: person.id });
            const [guest = '', linked = '', undone = ''] = people.map(({ id }) => id);
            const aliases = yield* db
                .insert(personAlias)
                .values([
                    { communityId, alias: 'A', aliasNorm: 'a', personId: linked, resolution: 'confirmed' },
                    { communityId, alias: 'B', aliasNorm: 'b', personId: guest, guestPersonId: guest, resolution: 'guest' },
                    { communityId, alias: 'C', aliasNorm: 'c', personId: guest, guestPersonId: guest, resolution: 'unresolved' },
                    { communityId, alias: 'Я', aliasNorm: 'я', kind: 'self', personId: linked, resolution: 'confirmed' }
                ])
                .returning({ id: personAlias.id });
            const [confirmedId = '', undoneId = ''] = aliases.map(({ id }) => id);
            const undo = (entityId: string, from: string) =>
                db.insert(auditLog).values({
                    communityId,
                    actorKind: 'user',
                    action: 'alias.unlink',
                    entityType: 'alias',
                    entityId,
                    diff: { from, to: guest }
                });
            yield* undo(undoneId, undone);
            const backfill = Effect.fn('test.backfill')(function* () {
                yield* db.execute(sql`select identity.backfill_alias_links()`);

                return yield* db
                    .select({
                        aliasId: aliasLink.aliasId,
                        personId: aliasLink.personId,
                        during: sql<string>`${aliasLink.during}::text`,
                        status: aliasLink.status
                    })
                    .from(aliasLink)
                    .where(eq(aliasLink.communityId, communityId))
                    .orderBy(aliasLink.status, aliasLink.personId);
            });
            const links = yield* backfill();
            const again = yield* backfill();
            yield* db
                .update(personAlias)
                .set({ personId: guest, guestPersonId: guest, resolution: 'guest' })
                .where(eq(personAlias.id, confirmedId));
            yield* undo(confirmedId, linked);
            yield* db.update(personAlias).set({ personId: undone, resolution: 'confirmed' }).where(eq(personAlias.id, undoneId));
            const changed = yield* backfill();
            yield* db.update(personAlias).set({ personId: linked }).where(eq(personAlias.id, undoneId));
            const moved = yield* backfill();

            const overlapping = yield* Effect.exit(
                db.insert(aliasLink).values({
                    communityId,
                    aliasId: confirmedId,
                    personId: linked,
                    during: '[2025-01-01,2025-02-01)',
                    method: 'admin',
                    status: 'rejected'
                })
            );

            expect(links).toEqual([
                { aliasId: confirmedId, personId: linked, during: '(,)', status: 'approved' },
                { aliasId: undoneId, personId: undone, during: '(,)', status: 'rejected' }
            ]);
            expect(again).toEqual(links);
            expect(changed).toEqual([
                { aliasId: undoneId, personId: undone, during: '(,)', status: 'approved' },
                { aliasId: confirmedId, personId: linked, during: '(,)', status: 'rejected' }
            ]);
            expect(moved).toEqual([
                { aliasId: undoneId, personId: linked, during: '(,)', status: 'approved' },
                { aliasId: confirmedId, personId: linked, during: '(,)', status: 'rejected' }
            ]);
            expect(Exit.isFailure(overlapping)).toBe(true);
        })
    );

    it.effect('lets a sign-up event go only together with its sign-up, whatever the session settings say', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const communityId = yield* seedCommunity('signup-events');
            const [activityRow] = yield* db
                .insert(activity)
                .values({ communityId, sport: 'football', name: 'Football' })
                .returning({ id: activity.id });
            const [personRow] = yield* db.insert(person).values({ displayName: 'Player' }).returning({ id: person.id });
            const sessionOf = () =>
                db
                    .insert(session)
                    .values({
                        communityId,
                        activityId: activityRow?.id ?? '',
                        localDate: '2026-12-01',
                        startsAt: new Date('2026-12-01T18:00:00Z')
                    })
                    .returning({ id: session.id });
            const [kept] = yield* sessionOf();
            const [gone] = yield* sessionOf();
            for (const sessionId of [kept?.id ?? '', gone?.id ?? '']) {
                const [signupRow] = yield* db
                    .insert(signup)
                    .values({ sessionId, personId: personRow?.id ?? '', status: 'in' })
                    .returning({ id: signup.id });
                yield* db.insert(signupEvent).values({ signupId: signupRow?.id ?? '', toStatus: 'in' });
            }
            const direct = yield* Effect.exit(
                db.transaction(() =>
                    db
                        .execute(sql`select set_config('rondo.erase_game', 'on', true)`)
                        .pipe(Effect.andThen(db.execute(sql`delete from scheduling.signup_event`)))
                )
            );
            const cascaded = yield* Effect.exit(db.delete(session).where(eq(session.id, gone?.id ?? '')));
            const left = yield* db.select({ signupId: signupEvent.signupId }).from(signupEvent);

            expect(Exit.isFailure(direct)).toBe(true);
            expect(Exit.isSuccess(cascaded)).toBe(true);
            expect(left).toHaveLength(1);
        })
    );

    it.effect('stores the money red bib as red, keeps its squads on the same row and leaves an existing red alone', () =>
        Effect.gen(function* () {
            const db = yield* Db;
            const settings = {
                ingest: {
                    teamColors: [
                        { emoji: '💷', name: 'orange' },
                        { emoji: '💶', name: 'blue' }
                    ]
                }
            };
            const [moneyId = '', withRedId = ''] = (yield* db
                .insert(community)
                .values([
                    { slug: 'money-red', name: 'Money', settings },
                    { slug: 'money-red-taken', name: 'Taken', settings }
                ])
                .returning({ id: community.id })).map(({ id }) => id);
            const [activityRow] = yield* db
                .insert(activity)
                .values({ communityId: moneyId, sport: 'football', name: 'Football' })
                .returning({ id: activity.id });
            const [orange] = yield* db
                .insert(teamColor)
                .values([
                    { communityId: moneyId, name: 'orange', emoji: '💷' },
                    { communityId: withRedId, name: 'orange', emoji: '💷' },
                    { communityId: withRedId, name: 'red', emoji: '🔴' }
                ])
                .returning({ id: teamColor.id });
            const [game] = yield* db
                .insert(session)
                .values({
                    communityId: moneyId,
                    activityId: activityRow?.id ?? '',
                    localDate: '2026-01-02',
                    startsAt: new Date('2026-01-02T18:00:00Z')
                })
                .returning({ id: session.id });
            yield* db.insert(team).values({ sessionId: game?.id ?? '', ordinal: 1, colorId: orange?.id });
            const badges = readFileSync(
                fileURLToPath(new URL('../drizzle/20261125101540_team_badges/migration.sql', import.meta.url)),
                'utf8'
            )
                .split('--> statement-breakpoint')
                .map(statement => statement.trim());

            for (const statement of [...badges, ...badges]) {
                yield* db.execute(sql.raw(statement));
            }

            const colours = yield* db
                .select({ communityId: teamColor.communityId, name: teamColor.name, emoji: teamColor.emoji })
                .from(teamColor)
                .orderBy(teamColor.name);
            const [squad] = yield* db
                .select({ colorId: team.colorId })
                .from(team)
                .where(eq(team.sessionId, game?.id ?? ''));
            const [stored] = yield* db.select({ settings: community.settings }).from(community).where(eq(community.id, moneyId));

            expect(colours.filter(colour => colour.communityId === moneyId)).toEqual([{ communityId: moneyId, name: 'red', emoji: '💷' }]);
            expect(colours.filter(colour => colour.communityId === withRedId).map(({ name }) => name)).toEqual(['orange', 'red']);
            expect(squad?.colorId).toBe(orange?.id);
            expect(stored?.settings).toEqual({
                ingest: {
                    teamColors: [
                        { emoji: '💷', name: 'red' },
                        { emoji: '💶', name: 'blue' }
                    ]
                }
            });
        })
    );
});
