# ADR-0003: Telegram-ID-first identity

- **Status:** Accepted (2026-11-24)
- **Deciders:** maintainers

## Context

Line-ups name players by nickname, and nicknames decide nothing: they repeat, change and carry typos.
Telegram ids are permanent. The history has an author id on every message and the voters of public polls,
so most players have an id, but a line-up token rarely does.

## Decision

| Concern | Choice |
|---|---|
| Person and account | A person has any number of `identity.telegram_account` rows. The numeric id is the key; a username is a current attribute and belongs to the account that showed it last |
| Line-up token | Kept verbatim in `play.lineup_entry` with `resolved_by`. Order: user id in the message at that token, author for "Я", current @handle, confirmed alias, vote match, guest |
| Roster | `syncSessionRoster` derives `team_member` and `attendance` from the entries. Attendance with `source = 'manual'` and entries with `resolved_by = 'manual'` win |
| Nickname to person | One to one by default. Each alias keeps its own guest person in `person_alias.guest_person_id`, so `unlinkAlias` restores the previous state. An unlinked alias becomes `guest` and is never linked automatically again |
| Shared nickname | An alias that appears twice in one line-up, not counting tokens with "+N", is a `placeholder`. Occurrence 1 and 2 are separate guests (`alias_norm` "name" and "name #2"). It is never linked as a whole, only per entry, and stays out of player rankings. The kind is derived and stays once set |
| Vote match | Linked automatically only with at least 10 games having both line-up and voters, at least 90% of them with the account among yes voters, account and alias each other's best by F1 with a margin of at least 0.12 on both sides, and no line-up in which the player appears under another name. A person with a confirmed nickname gets no second one. Vote links are recomputed on every import. Everything else is a suggestion, computed on demand and never stored |
| Guests | "+N" makes N entries with `guest_of_person_id`, never a person. Chat messages "+N" count only as a reply to a game poll of a game without a line-up (team ordinal 0) |
| Sign-ups from history | A yes vote means signed up, not attended. Games without a line-up have unknown attendance. Of two answers the first is yes; with more answers the wording decides (`yes`, `no` or `other`). The latest vote of a person for a game counts |
| Shown name | Admin rename, then the most frequent linked nickname as written, then the Telegram name |
| Merge | `identity.merge_person` accepts several accounts and refuses on any conflict instead of deleting. Only the membership of one community and notification preferences are combined |
| Privacy | Link and merge audit entries hold ids, not names |

## Consequences

- A wrong link is undone by unlinking; a merge is not reversible, so links come first.
- Re-imports update sessions in place, keep links and manual records, and skip messages the bot handled live.
- The snapshot is the newest read at import time, so it refreshes names, usernames and membership.
- An admin link on a nickname that later turns out to be shared is dropped, because one link cannot name two people.
- `identity.telegram_author` is still written; accounts replace it for exports with ids.
