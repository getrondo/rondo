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
    "teamColors": [{ "emoji": "💷", "name": "red" }],
    "squads": [
        { "name": "Team-2", "patterns": ["^team\\s?2$"], "contextPatterns": ["5\\s*лиг"] },
        { "name": "Team", "patterns": ["^team$"], "contextPatterns": [] }
    ]
}
```

- `organizers`: authors whose messages count as authoritative (cancellations, prices, results).
- `selfAliases`: how the organizer lists himself in line-ups ("Я" = "me").
- `venues[].patterns` and `squads[].patterns`: case-insensitive regexes, tried in order.
- `gamesTopicId` (optional): the forum topic that games are posted in; without it only posts outside any topic (General) count. Needs the snapshot, which carries the topics.
- `guestPatterns` (optional): case-insensitive regexes for tokens that describe a one-game guest instead of naming a player; the named groups `host` and `count` are read. It replaces the generic default in `community-config.ts`.
- `otherChats` (optional): more chats of the same community, each with its Telegram `chatId`, its `exportDir` relative to `RONDO_EXPORT_DIR` and `matchPatterns`, words of polls that are matches, cups or friendlies, `matchDates` (optional), days without weekly games, and `ownGameDates` (optional), days on which a game of this chat stays apart from the main game when their times differ or one is missing. A chat id or directory may be listed once and never be the main chat's. The bot follows the same rules when it is linked to that chat. When a group becomes a supergroup, the bot moves the stored chat id; change `chatId` in the private config too. The directory holds a Telethon dump: `messages.jsonl` (`to_json`, one message per line), `users*.json` and `votes*.jsonl`. Only weekday games that are no matches become sessions; the import logs how many polls and squads need a review and writes their chat id, message id and date to `RONDO_REVIEW_FILE` (optional, outside the repository, readable by its owner only). A missing or empty `messages.jsonl`, or stored posts of a chat that is neither linked as the main one nor listed here, stops the import before it changes anything. Link the main group to the bot before the others: an imported poll of the main chat counts as posted to the first linked group.
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
deleted unless they carry sign-ups, manual attendance, manual entries, admin changes or messages the bot handled.
Fixtures, price rules and provenance of the import are replaced. Venues are upserted by `(community_id, name)`, aliases by
`(community_id, alias_norm)`. Messages in `comms.message_ref` are skipped, and a line-up the bot took live is left alone.
Confirmed and undone links, manual line-up entries and manual attendance survive. Vote links are recomputed
([ADR-0003](../adr/0003-identity.md)). A snapshot only fills what is missing.

Run it outside game hours. The import holds the community lock, so live line-ups and admin changes wait until it ends. On a local copy of
production (20,078 messages, 405 games) one import takes about 5 seconds; over the network to Neon expect longer.

The lock test needs two real sessions and is skipped without a local Postgres:
`RONDO_TEST_DATABASE_URL=postgres://… pnpm -F @rondo/core test`.

An import that would remove more than 5% of the imported games, or of the stored squads and their attendance, stops and prints the dates. Check them, then run it with
`RONDO_ALLOW_REMOVAL=true`.

### After a release that adds `identity.alias_link`

The migration turns earlier links and undone links into decisions. Links that the previous release changed while it was still running
are picked up by running the same step again, once it has stopped. It can be repeated:

```sql
select identity.backfill_alias_links();
```

### Owner decisions

Both kinds live in private files outside the repository, readable by their owner only. Load them after the migration and **before**
the import, so the import already follows them. Loading again changes nothing, and several lists can be loaded in a row.

- Nicknames: `nickname|Telegram id|line-up message id|date`, one per line, with `|chat id` at the end for a squad of another chat. The chat id only narrows the comparison: the approved day applies to all chats. Each line is stored as an approved day in
  `identity.alias_link` and replaces a rejection of that day. A missing account or nickname is created. `overlapDates` lists days on
  which another player is approved for the same nickname, which is normal only for shared nicknames.
- Games: `date|sport|played` or `date|sport|cancelled`. The game gets the status and a `scheduling.session_change` row, which is what
  makes every later import keep it. The game must exist already; the output lists the missing ones and
  days with several games.

```bash
export RONDO_COMMUNITY_CONFIG=/path/to/community.json RONDO_APPROVALS_DECIDED_AT=2026-11-24 RONDO_APPROVALS_MODE=load
RONDO_APPROVALS_FILE=/path/to/approved-links.txt pnpm -F @rondo/ingest-telegram approvals
RONDO_APPROVALS_CONTENT=games RONDO_APPROVALS_FILE=/path/to/game-decisions.txt pnpm -F @rondo/ingest-telegram approvals
```

After the import, run the same commands with `RONDO_APPROVALS_MODE=compare`: it only reads and prints counts and message ids, no
names.

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
- **Games to review:** `session.review_reason` marks games whose cancellation is unclear.
- **Guest messages:** `unassignedGuestRequests` counts chat messages "+N" that reply to no game poll; they are not stored.
- **Sessions without a line-up** are marked `played` with confidence ≤ 0.6 and have no attendance, only sign-ups from votes; cancelled ones carry `cancel_reason`.
- **Prices** are the monthly mode of "€N on the field" messages, scoped per venue when the message names one.

## What it extracts

| Signal | Source | Rule |
|---|---|---|
| Session | game polls (not reserve polls) and posted line-ups | merged by local date and sport; date from the poll text (explicit date, today/tomorrow, weekday) |
| Poll days | poll text | explicit date first, the weekday when that date has passed; a poll that offers several days joins the day that was played |
| Votes | snapshot | one poll counts once, whatever its forwards; with three or more answers a time, a format or plain participation is yes, a refusal is no, a preference is neither |
| Status | line-up → played; organizer cancel message → cancelled with reason (weather, low turnout, venue, holiday) | |
| Teams and attendance | line-ups split by team-colour emoji | GK and newcomer markers, organizer self-alias |
| Price rules | organizer "по N евро" lines | monthly mode, venue-scoped, GK detected on the same line |
| Fixtures | organizer result posts "A - B … score" | squad from name or league context; competition (league level) and season |
| Venues | config patterns over poll titles and line-up headers | |
