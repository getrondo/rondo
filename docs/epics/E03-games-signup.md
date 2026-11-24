# E03 · Games & one-tap signup (replace the poll)

**Milestone:** M1 Replace the poll · **Priority:** P0

## Goal

Organizers create a game in seconds (or from a recurring template); players sign up with one tap on a live game card that always shows who's in, who's waiting, and the essentials.

## Evidence from the community

- 559 polls, 99% by one organizer, each with a hand-typed title: day, date, time, venue, fields, cap.
- Players can't find out how to change a vote, remove '+' silently, mis-vote in multi-option polls, or miss polls in a muted chat.
- The organizer re-forwards polls to bump them and asks people not to write after posting.

## User stories

- **E03-S01** As an organizer, I create a game with `/newgame` or a Mini App form: activity, date, time and duration, venue and field(s), min and max players, GK slots, price, signup opening time, cancellation cutoff.
- **E03-S02** As an organizer, I define recurring templates (e.g. 'Monday 19:00 Kendlerstraße, 18 players, €10') that auto-publish N hours before.
- **E03-S03** As a player, I tap **I'm in / Maybe / I'm out** on the game card; I can change my answer any time, and 'out' is explicit (no silent removal).
- **E03-S04** As a player, I add '+1 guest' with a name from the card.
- **E03-S05** As a player, I get the game card or a reminder in a DM even if I muted the group (opt-in notification preferences).
- **E03-S06** As an organizer, I run a quick multi-option poll (time slot, venue or format) whose result converts into a game.
- **E03-S07** As a member, I see a compact live roster in the group, re-pinned and edited in place instead of re-posted.
- **E03-S08** As an organizer, I see who has *not* responded among regulars and nudge them with one tap.

## Acceptance criteria

- The game card updates in place within 2 seconds of any change; one card per game, pinned while open.
- Signup state changes are timestamped (needed for waitlist order, late-cancel rules and reliability).
- Native Telegram poll mode is available as a fallback (bot-sent non-anonymous poll, answers captured via `poll_answer`).
- Time, venue and cap changes after publishing notify everyone signed up (see E06).

## Out of scope

- Public game discovery for strangers (later)
