# E07 · Payments ledger (track only)

> **Dropped (2026-11-24):** payments are out of scope. Kept for reference.

**Milestone:** M1 Replace the poll · **Priority:** P0

## Goal

A per-game, per-person ledger of what's owed and paid (cash or SEPA), with collectors, special tariffs, fees and event cost splits, so the organizer stops chasing money from memory. No money moves through Rondo.

## Evidence from the community

- Price went €7 → €8 → €10; goalkeepers €5; school hall €5; cap-dependent price ('€10 at 15 players, €15 at 10').
- Cash is collected at the field by a designated collector, or SEPA to the organizer before the game; unpaid players are chased by hand.
- Pay-before-the-game rule and late-cancel fee added because of arrears; BBQs are split by receipts.

## User stories

- **E07-S01** As an organizer, I set price rules per game or template: flat, role-based (GK), headcount-based, guest price, free-for-life (hall of fame).
- **E07-S02** As a collector, I mark players paid (cash or transfer) from a checklist on my phone during warm-up.
- **E07-S03** As a player, I tap 'I paid by transfer'; the organizer confirms it.
- **E07-S04** As a player, I see my balance and unpaid games; I get a polite reminder if I owe.
- **E07-S05** As an organizer, I see a debt overview and the venue cost against collected money per game (my own P&L).
- **E07-S06** As an organizer, I split an event cost (BBQ receipts) among attendees, with exemptions (kids).
- **E07-S07** As a sponsor of a guest, the guest's fee is attributed to me unless the guest pays.
- **E07-S08** As an organizer, I share payment details (IBAN, payee name) via the bot in DM, never in the group.

## Acceptance criteria

- Ledger entries are append-only with corrections as new entries; full audit trail.
- Late-cancel and no-show fees appear only after organizer approval (from E04).
- Export to CSV per month.

## Out of scope

- Stripe or Telegram Payments
- Automatic bank reconciliation (later: optional import of bank CSV)
