# E06 · Rescheduling, cancellation & weather go/no-go

**Milestone:** M1 Replace the poll · **Priority:** P0

## Goal

Decisions about the second field, weather, holidays and low turnout are made at the right time with data, and everyone affected is notified once, clearly.

## Evidence from the community

- The second field is confirmed or dropped by a venue deadline (14:00–21:00), based on headcount thresholds ('24 on 1 field or 32+ on 2').
- Weather (rain, snow, heat, thunderstorms) triggers ad-hoc 'are we playing?' polls; some games were cancelled on the day, leaving people at the venue.
- Austrian public and school holidays regularly move games to the next day.

## User stories

- **E06-S01** As an organizer, I set decision checkpoints per game (e.g. 'second field decision at 14:00', 'weather check at 16:00') and get a DM with the current signups, forecast and a recommendation.
- **E06-S02** As an organizer, I see the forecast (precipitation, wind, temperature, thunderstorm risk) for the venue at kick-off time from GeoSphere Austria or Open-Meteo.
- **E06-S03** As an organizer, I get a suggested format from the headcount (fields × teams × subs), e.g. '21 players → 1 field, 3 teams of 7'.
- **E06-S04** As an organizer, I cancel or reschedule with one action; the bot notifies all signed-up and waitlisted players by DM and in the group, and asks them to re-confirm for the new slot.
- **E06-S05** As an organizer, I see upcoming Austrian public and school holidays (Vienna) when creating games and templates.
- **E06-S06** As a player, I get a reminder 2–3 hours before the game with any changes highlighted.

## Acceptance criteria

- Every change (time, venue, field, cap, cancel) produces exactly one diff-style notification per affected player.
- Re-confirmation for a moved game keeps the original order for those who confirm within the window.
- No automatic cancellation without organizer confirmation.

## Out of scope

- Automatic venue rebooking
