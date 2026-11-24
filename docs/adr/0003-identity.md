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
| Shared nickname | An alias that appears twice in one line-up in at least 2 games is a `placeholder`; it has no person. A single repeat is a slip: the first entry is the person, the second is unidentified. `X` beside `X +N` is X once plus N guests of X |
| Unidentified entry | A player entry may have no person: it counts as a head in the line-up, never as attendance of a person. Descriptions ("friend of X", "new", `guestPatterns` in the community config) are one-game guests; a friend of X is a guest of X when X resolves |
| Periods | A nickname is one person within a continuous period. Its timeline is split at gaps over 180 days, and where the player changes inside a period: an earlier or later run of at least 10 games that qualifies for another player on its own is split off, even when the whole period would qualify. Each period is judged alone against the yes votes of that period. Links go to the entries; the whole alias is linked only when every period agrees |
| Vote match | Automatic only with at least 10 games having both line-up and voters, at least 90% of them with the account among yes voters, account and alias each other's best by F1 in that period with a margin of at least 0.12 on both sides, and no line-up in which the player appears under another name. One account gets one nickname automatically; a person with a confirmed nickname gets no second one. Names are never evidence. Links are recomputed on every import; everything else is a suggestion, computed on demand |
| Shared vote match | For a shared nickname, the set of k accounts that best explains it: 2 × Σ min(entries, set members voting yes) / (entries + yes votes of the set in the period). k is the largest number of entries in one line-up that occurs in at least 2 games, never less than 2. The set holds persons, so two accounts of one person count once. Accepted with a score of at least 0.85, a margin of at least 0.08 over the next set and at least 10 games; accounts that are in one of those line-ups under another name are not candidates. A game is assigned only when the number of set members voting yes equals the entries. Which entry is whom is then arbitrary: attendance is certain, the team is not when the entries are in different teams |
| Game polls | A poll is a game when it states a date plus a place or time. A poll with only a date joins a game that exists and has a plus answer. Of two answers the first is yes only when the first reads as yes or the second as no |
| Undo | `unlinkAlias` undoes every vote link of a nickname and blocks new ones. `unlinkEntry` on a vote link leaves a manual record that survives imports; on a manual link it returns to the automatic result |
| Guests | "+N" makes N entries with `is_guest` and `guest_of_person_id`, never a person. Chat messages "+N" count only as a reply to a game poll of a game without a line-up (team ordinal 0) |
| Sign-ups from history | A yes vote means signed up, not attended. Games without a line-up have unknown attendance. With more than two answers the wording decides (`yes`, `no` or `other`). The latest vote of a person for a game counts. Reserve polls are not linked |
| Shown name | Admin rename, then the most frequent linked nickname as written (shared nicknames excluded), then the Telegram name |
| Merge | `identity.merge_person` accepts several accounts and refuses on any conflict instead of deleting. Only the membership of one community and notification preferences are combined |
| Privacy | Link and merge audit entries hold ids, not names |

## Consequences

- A wrong link is undone by unlinking; a merge is not reversible, so links come first.
- The import and live line-ups take one community lock for their transaction, so they never interleave.
- A live line-up recorded before entries existed is backfilled from the export in its own game; teams the bot published are left alone.
- A manual entry that a new line-up no longer matches stays, unless its player is in the new line-up.
- A nickname no line-up, team or attendance uses is removed; its person row stays and is not shown.
- A merge confirms the nicknames of the merged person only.
- Re-imports match sessions by message, then by date and sport, update them in place, keep links, manual records and games an admin changed (`scheduling.session_change`), and skip messages the bot handled live.
- The snapshot is the newest read at import time, so it refreshes names, usernames and membership.
- An admin link on a nickname that later turns out to be shared is dropped, because one link cannot name two people.
- `identity.telegram_author` is still written; accounts replace it for exports with ids.
