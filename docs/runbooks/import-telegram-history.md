# Runbook: import Telegram group history

`@rondo/ingest-telegram` turns a Telegram Desktop export into rows in the Rondo database:
venues, sessions (with status and confidence), teams, attendance, player aliases, Telegram
authors, venue-scoped price history, league squads, competitions and fixtures, plus provenance
(`ingest.run`, `ingest.source_ref`, `ingest.extraction`).

Message bodies are **not** stored; only extracted facts are, including poll titles (`session.title`) and line-up names (`person_alias.alias`). Exports and community configs contain personal data. Keep
them outside the repository (e.g. `~/getrondo/rondo-data/`); `.gitignore` blocks the usual names.

## 1. Export the chat

Telegram Desktop → group → ⋮ → **Export chat history**. Untick photos, videos, voice and files
(they aren't used). The format can be **HTML** or JSON (HTML is supported today).

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

The import runs in one transaction. It replaces only the import-scoped facts of that community
(sessions and fixtures with `source = 'import'`, price rules with `note = 'import'`, plus ingest runs) and upserts the
rest: venues by `(community_id, name)` (venue names in the config must be unique; an existing venue keeps its `kind`), aliases by `(community_id, alias_norm)` and authors by
`(community_id, display_name)`. Re-running it on a newer export is safe **before go-live**: imported sessions are recreated with new ids, so once the bot attaches data to imported sessions, stop re-importing. Until then, curated data (alias
resolution and person links, manually added venues, bot-created sessions) is never overwritten, and
persons are created only for aliases that did not exist yet. An export folder without any
`messages*.html` page is rejected.

## 4. Review

- **Aliases:** `identity.person_alias` holds every line-up name with occurrences and first/last seen. Merge duplicates and typos and link them to Telegram accounts (E15 alias-resolution UI). Your resolutions survive re-imports.
- **Sessions without a line-up** are marked `played` with confidence ≤ 0.6; cancelled ones carry `cancel_reason`.
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
