# E01 · Platform foundations, i18n & privacy

**Milestone:** M0 Foundations · **Priority:** P0

## Goal

A deployable Telegram bot skeleton with persistence, roles, per-user language (Ukrainian or Russian, falling back to Ukrainian), GDPR basics and observability, so every later epic builds on solid ground.

## Evidence from the community

- Members write in Russian and Ukrainian interchangeably; some guests speak German or English.
- The chat contains addresses, health details and payment data; the community is in Austria (GDPR applies).
- The organizer is a single point of failure: when his poll broke, nobody else could run the game.

## User stories

- **E01-S01** As a player, I see every bot message in my language (`uk` or `ru` from Telegram `language_code`; anything else falls back to `uk`), and I can switch with `/lang`.
- **E01-S02** As an organizer, I add the bot to the group and run `/setup`, which links the group to a *community* with a timezone (Europe/Vienna) and currency (EUR).
- **E01-S03** As an owner, I assign roles: owner, organizer, helper (collector or key holder), player, guest.
- **E01-S04** As a player, I give consent on first interaction (DM `/start`) with a short privacy notice, and I can `/export_me` and `/delete_me`.
- **E01-S05** As a developer, I get structured logs, error reporting, health checks and a staging bot.
- **E01-S06** As an organizer, I can let a co-organizer run everything when I'm away (no single point of failure).

## Acceptance criteria

- All user-facing strings live in translation files (uk, ru; en/de stubs). No hard-coded text.
- Role checks enforced server-side for every mutating action.
- `/delete_me` anonymizes the player in history (stats stay as 'former player') within 30 days.
- Staging and production bots; CI runs typecheck, lint and tests; one-command deploy.

## Out of scope

- Payment processing
- Public web profiles
