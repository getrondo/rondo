# E15 · History import & bootstrap

**Milestone:** M2 Know your players · **Priority:** P1

## Goal

Bootstrap Rondo with 3.5 years of history from the Telegram export: games, venues, line-ups mapped to players, so stats and ratings aren't empty on day one.

## Evidence from the community

- 210 posted line-ups give real attendance; 559 polls give dates, venues, caps and formats.
- Aliases must be mapped to people before anything is meaningful (628 aliases, about 130 recurring).

## User stories

- **E15-S01** As an admin, I upload a Telegram Desktop export (HTML or JSON) and the importer extracts games, venues, line-ups and teams.
- **E15-S02** As an admin, I resolve aliases to players in a guided UI: suggestions by frequency and co-occurrence, and a 'merge' or 'guest' action.
- **E15-S03** As an admin, I review the import diff before committing; imported records are marked as such.
- **E15-S04** As an organizer, initial skill ratings are seeded from attendance and the team distribution of imported line-ups (low confidence).

## Acceptance criteria

- The import is idempotent and can be re-run on a newer export.
- Raw exports are processed and then deleted; only structured data is kept (GDPR minimization).
- Never commit raw exports or personal data to the repo.

## Out of scope

- Importing media
