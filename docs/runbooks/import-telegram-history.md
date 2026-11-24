# Runbook: import Telegram group history

`@rondo/ingest-telegram` turns a Telegram Desktop export into rows in the Rondo database:
venues, sessions (with status and confidence), teams, attendance, player aliases, Telegram
authors, venue-scoped price history, league squads, competitions and fixtures, plus provenance
(`ingest.run`, `ingest.source_ref`, `ingest.extraction`).

Message bodies are **not** stored; only extracted facts are, including poll titles (`session.title`) and line-up names (`person_alias.alias`). Exports and community configs contain personal data. Keep
them outside the repository (e.g. `~/getrondo/rondo-data/`); `.gitignore` blocks the usual names.

## 1. Export the chat

Telegram Desktop → group → ⋮ → **Export chat history**. Untick photos, videos, voice and files
(they aren't used). Choose **JSON** (`result.json`): it carries author ids. HTML still works, without ids.

Optional snapshot files in the same folder, read from the owner's account, add accounts, polls and voters: `messages.jsonl` (polls with `poll.id` and answers), `votes*.jsonl` and `users*.json` (schemas in `packages/ingest-telegram/src/model/telegram-snapshot.model.ts`). Without `messages.jsonl` the import runs without them.

## 2. Write the community config

A JSON file validated by `CommunityConfigSchema` (`packages/ingest-telegram/src/config/community-config.ts`):

```json
{
    "slug": "my-club",
    "name": "My Club",
    "timeZone": "Europe/Vienna",
    "organizers": ["<organizer display name as in the export>"],
    "selfAliases": ["Я"],
    "venues": [{ "key": "main", "name": "Main Field", "kind": "training", "district": 14, "lat": 48.19, "lng": 16.28, "patterns": ["main", "основное поле"] }],
    "teamColors": [{ "emoji": "💷", "name": "orange" }],
    "squads": [
        { "name": "Team-2", "patterns": ["^team\\s?2$"], "contextPatterns": ["5\\s*лиг"] },
        { "name": "Team", "patterns": ["^team$"], "contextPatterns": [] }
    ]
}
```

- `organizers`: authors whose messages count as authoritative (cancellations, prices, results).
- `selfAliases`: how the organizer lists himself in line-ups ("Я" = "me").
- `venues[].patterns` and `squads[].patterns`: case-insensitive regexes, tried in order.
- `guestPatterns` (optional): case-insensitive regexes for tokens that describe a one-game guest instead of naming a player; the named groups `host` and `count` are read. It replaces the generic default in `community-config.ts`.
- `squads[].contextPatterns`: message-level hints (league level) that pick the squad.

## 3. Run

```bash
pnpm db:up                       # local Postgres 17 (docker compose, port 54329)
pnpm db:migrate                  # DATABASE_URL from .env
DATABASE_URL=postgres://rondo:rondo@localhost:54329/rondo \
RONDO_EXPORT_DIR=/path/to/ChatExport_... \
RONDO_COMMUNITY_CONFIG=/path/to/community.json \
pnpm -F @rondo/ingest-telegram ingest
psql "$DATABASE_URL" -c "select analytics.refresh_all()"
```

The import runs in one transaction and can be repeated. Sessions are matched by their messages, then by local date and sport,
and updated in place. Games an admin changed keep their date, time, venue and status. Imported sessions that are gone are
deleted unless they carry sign-ups, manual attendance, admin changes or messages the bot handled.
Fixtures, price rules and provenance of the import are replaced. Venues are upserted by `(community_id, name)`, aliases by
`(community_id, alias_norm)`. Messages in `comms.message_ref` are skipped, and a line-up the bot took live is left alone.
Confirmed and undone links, manual line-up entries and manual attendance survive. Vote links are recomputed
([ADR-0003](../adr/0003-identity.md)). A fresh snapshot overwrites account names, usernames and membership.

### Rehearse first

On a restored copy of production on localhost:

```bash
DATABASE_URL=postgres://rondo:rondo@localhost:54330/rondo \
RONDO_EXPORT_DIR=/path/to/export RONDO_COMMUNITY_CONFIG=/path/to/community.json \
pnpm -F @rondo/ingest-telegram rehearse
```

It migrates, imports twice and prints counts before and after. It refuses any other host and prints no names. The second
import must report that it changed nothing.

## 4. Review

- **Aliases:** `identity.person_alias` holds every line-up name. `vote` links are automatic: check them and unlink wrong ones. Ask the assistant for link suggestions. Shared nicknames (`placeholder`) are linked per line-up entry. `reviewEntries`, `linkEntry` and `unlinkEntry` in `@rondo/core` list and fix entries (no UI yet).
- **Guest messages:** `unassignedGuestRequests` counts chat messages "+N" that reply to no game poll; they are not stored.
- **Sessions without a line-up** are marked `played` with confidence ≤ 0.6 and have no attendance, only sign-ups from votes; cancelled ones carry `cancel_reason`.
- **Prices** are the monthly mode of "€N on the field" messages, scoped per venue when the message names one.

## What it extracts

| Signal | Source | Rule |
|---|---|---|
| Session | game polls (not reserve polls) and posted line-ups | merged by local date and sport; date from the poll text (explicit date, today/tomorrow, weekday) |
| Status | line-up → played; organizer cancel message → cancelled with reason (weather, low turnout, venue, holiday) | |
| Teams and attendance | line-ups split by team-colour emoji | GK and newcomer markers, organizer self-alias |
| Price rules | organizer "по N евро" lines | monthly mode, venue-scoped, GK detected on the same line |
| Fixtures | organizer result posts "A - B … score" | squad from name or league context; competition (league level) and season |
| Venues | config patterns over poll titles and line-up headers | |
