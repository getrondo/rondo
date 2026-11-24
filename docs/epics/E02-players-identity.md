# E02 · Players, identity, aliases & guests

**Milestone:** M1 Replace the poll · **Priority:** P0

## Goal

One stable player record per human, linked to Telegram when possible, with nicknames, roles (e.g. goalkeeper) and support for guests who aren't on Telegram.

## Evidence from the community

- Line-ups use 628 distinct aliases: first names, nicknames, duplicates, descriptive suffixes.
- Up to 8 of 24 players in a game are not on Telegram; they are added as '+1' or 'not on Telegram'.
- Goalkeepers are a scarce role with their own price and slots.

## User stories

- **E02-S01** As a player, my profile is created automatically when I first interact; I can set a display nickname.
- **E02-S02** As an organizer, I add a guest by name ('+1 Ivan from Max') who is counted, assigned to a team and charged, without a Telegram account.
- **E02-S03** As an organizer, I merge a guest into a real account when they later join Telegram, keeping their history.
- **E02-S04** As a player, I mark preferred positions (GK, defence, attack, any) and dominant foot (optional).
- **E02-S05** As an organizer, I see and edit aliases ('two people named Artem': disambiguate with a suffix).
- **E02-S06** As a member, I can see who is a regular, occasional or new player (a badge, not a rating).

## Acceptance criteria

- A player has: id, telegram_user_id (nullable), display name, aliases[], roles[], positions[], language, joined_at, invited_by.
- Guests always have a sponsor (the inviting player) who is responsible for them and their payment.
- Merge is reversible for 7 days and fully audited.

## Out of scope

- KYC or real-name verification
