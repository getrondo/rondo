# E10 · Post-game feedback & peer ratings

**Milestone:** M2 Know your players · **Priority:** P1

## Goal

Two-tap feedback after every game: overall rating, MVP vote, team-balance rating, venue rating, an optional comment, and private peer ratings that improve balancing.

## Evidence from the community

- The organizer collected feedback by DM after new venues and tournaments and then changed formats based on it.
- Balance complaints and conduct issues surfaced only in public chat arguments.
- Prizes for best player or most assists were given by hand; players wanted recognition.

## User stories

- **E10-S01** As a player who attended, I get a DM 30–60 min after the game: 'How was it? ⭐1–5', 'Were teams fair?', 'MVP?' (choose from the roster).
- **E10-S02** As a player, I can optionally rate up to 5 teammates' level privately (1–5), used only as input to balancing.
- **E10-S03** As a player, I can report an incident or conduct issue privately to organizers.
- **E10-S04** As an organizer, I see an aggregate dashboard: satisfaction trend, balance perception, venue scores, comments.
- **E10-S05** As a member, I see the MVP of the game announced in the group.

## Acceptance criteria

- Feedback is anonymous to other players; organizers see aggregates plus comments, with the author name only for incident reports.
- One reminder at most; closes after 24h.
- Peer ratings are weighted by rater reliability and blended conservatively into skill ratings.

## Out of scope

- Public player reviews
