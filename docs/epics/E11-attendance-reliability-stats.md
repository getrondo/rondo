# E11 · Attendance, reliability & personal stats

**Milestone:** M2 Know your players · **Priority:** P1

## Goal

Know who plays, how often and how reliably, and give every player a personal stats page: games, streaks, wins, goals and MVPs.

## Evidence from the community

- The organizer wanted to clean out people who hadn't played for 2+ months; 'of ~100 members only ~20 actually play'.
- No-shows and late cancellations were called out in chat but never tracked.
- Players asked 'who keeps statistics?' and the answer was 'everyone for himself'.

## User stories

- **E11-S01** As a player, `/me` shows my games this season, attendance streak, win rate (from mini-games), goals and assists, MVPs and reliability.
- **E11-S02** As an organizer, I see attendance per player and month, churned regulars, newcomers who didn't return, and late-cancel and no-show rates.
- **E11-S03** As an organizer, I see community health: games per week, average fill rate, waitlist length, cancellations by reason.
- **E11-S04** As a member, I see public leaderboards for attendance, goals and MVPs (never skill ratings).
- **E11-S05** As an organizer, I get a monthly digest in DM.

## Acceptance criteria

- Reliability = f(late cancels, no-shows, on-time confirmations) over a rolling window; visible to the player and admins only.
- All stats can be filtered by activity and season.
- Historical data from the import (E15) is included and marked as 'imported'.

## Out of scope

- Advanced analytics such as xG
