# E09 · Match day: formats, rotation & results

**Milestone:** M2 Know your players · **Priority:** P1

## Goal

Run the session on the pitch: format templates (3-team rotation, 2 or 3 fields, mini-tournament), a match timer, quick score entry per mini-game, and an auto-calculated table for the day.

## Evidence from the community

- Rotation rules are complex and change: '6 min or 2 goals', 'max 2 wins in a row; draw → longer-playing team leaves', 'winner of the small field moves up'.
- Hand-written round-robin tables with emoji were posted a few times; players repeatedly asked for scores, stats and live updates.
- Mini-tournaments (5 teams, 2 fields) were run with prizes.

## User stories

- **E09-S01** As an organizer, I pick a format template (3 teams rotation, 4 teams on 2 fields, round robin, mini-tournament with playoffs) with configurable rules.
- **E09-S02** As a scorekeeper (any helper on the bench), I enter each mini-game result in two taps; the next match-up is suggested by the rotation rule.
- **E09-S03** As a player, I optionally log my goals and assists after the game, confirmed by a teammate or the organizer.
- **E09-S04** As a member, I see the day's table and results posted to the group after the session.
- **E09-S05** As an organizer, I record incidents (injury, red card, early leave) for the game.

## Acceptance criteria

- Works on a phone with gloves and bad light: big buttons, offline-tolerant (queued updates).
- Mini-game results feed the rating model (E08).
- Goals and assists are optional and never block the results flow.

## Out of scope

- Video analysis
- Live streaming
