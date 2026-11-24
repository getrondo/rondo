# E08 · Team balancing

**Milestone:** M2 Know your players · **Priority:** P1

## Goal

Generate fair teams in seconds from real history: hidden skill ratings, goalkeeper distribution, constraints (pairs, positions), team count by headcount and bib colours. The organizer reviews and posts.

## Evidence from the community

- The organizer builds 3–4 colour-coded line-ups by hand 30–90 minutes before every game (210 line-up posts).
- Captains' picks were tried and abandoned in favour of organizer-balanced teams; some imbalance complaints were formal.
- Goalkeepers are pinned one per team; friends are kept together or deliberately split; newcomers are placed by self-declared level.

## User stories

- **E08-S01** As an organizer, I press 'Make teams' and get N balanced teams for the confirmed players, with one goalkeeper each where possible.
- **E08-S02** As an organizer, I add constraints: keep together, keep apart, fixed team (myself), position balance.
- **E08-S03** As an organizer, I drag players between teams in the Mini App and see the balance score update.
- **E08-S04** As an organizer, I publish the line-up to the group with team colours and bibs; each player sees 'You are in 🟢 Green'.
- **E08-S05** As an organizer, I seed ratings for newcomers (self-declared level plus my estimate) and the system learns from results.
- **E08-S06** As an organizer, I compare 'balance predicted' against 'actual goal difference' over time.

## Acceptance criteria

- Rating model: OpenSkill/TrueSkill-style (μ, σ) per player per activity, updated from mini-game results (E09) and optionally blended with peer ratings (E10).
- Ratings and balance scores are visible to admins only (decision 2026-11-24).
- Balancing 30 players into 4 teams with constraints takes under 1 second.
- Works without results: falls back to organizer seed ratings and attendance.

## Out of scope

- Public skill leaderboards
