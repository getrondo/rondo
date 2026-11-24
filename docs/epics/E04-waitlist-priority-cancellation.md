# E04 · Waitlist, priority & cancellation policy

**Milestone:** M1 Replace the poll · **Priority:** P0

## Goal

Encode the community's real fairness rules (first come, priority holds, reserve-gets-priority-next-time, cancellation cutoffs and fees) so the bot runs them instead of the organizer's memory.

## Evidence from the community

- 'First N are in, the rest are reserve'; spots that open up are announced by hand and the reserve is pinged by name.
- Informal priority: reserve last time gets priority next time; held slots for specific people; GK slots.
- Rule since Sep 2026: cancelling after 14:00 on game day, or not showing, means paying the full price.

## User stories

- **E04-S01** As a player beyond the cap, I'm put on the waitlist in signup order and see my position.
- **E04-S02** As a waitlisted player, I'm auto-promoted when someone drops out and get a DM with a 'confirm within X min' button; if I don't confirm, the next one is offered.
- **E04-S03** As an organizer, I configure per-community rules: priority holds, 'reserve last time gets priority', separate GK slots, early-access windows for regulars.
- **E04-S04** As an organizer, I set a cancellation cutoff per game or venue; a cancellation after it is flagged 'late' and can create a fee in the ledger (E07) after my confirmation.
- **E04-S05** As an organizer, I mark no-shows after the game in two taps.
- **E04-S06** As a player, I see the rules that apply to me before I sign up (cutoff time, fee).

## Acceptance criteria

- Waitlist promotion is deterministic and logged; ties are resolved by timestamp.
- Promotion stops at a configurable 'freeze' time (e.g. 60 min before kick-off) and switches to a broadcast to all waitlisted players: 'first to tap gets it'.
- Fees are never auto-charged without organizer approval (bot proposes, human decides).

## Out of scope

- Automated bans
