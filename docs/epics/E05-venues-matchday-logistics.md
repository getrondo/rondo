# E05 · Venues & match-day logistics

**Milestone:** M1 Replace the poll · **Priority:** P0

## Goal

Every game knows exactly where it is: venue, field number, changing room, key holder, parking rules and arrival notes. Players ask the bot (or just look at the card) instead of the chat.

## Evidence from the community

- 229 messages asking about changing rooms, fields, keys or addresses; 205 'running late' messages.
- Two venues share the same U1 stop and are regularly confused; people went to the wrong place after late changes.
- Venue rules (no parking, hard end times, keys, cancellation fees, entry deadlines, footwear) are repeated in long posts.

## User stories

- **E05-S01** As an organizer, I maintain a venue registry: name, address, map pin, public transport, fields (size and format), indoor or outdoor, surface, changing rooms, parking, rules, cancellation policy, photos.
- **E05-S02** As a player, I tap 'Where?' on the game card to get the pin, route link, field number and arrival notes.
- **E05-S03** As the first player to arrive, I post the changing room number to the card (`/room 5`), and everyone signed up sees it.
- **E05-S04** As an organizer, I assign match-day duties: key holder, bib and ball carrier, cash collector. Duty holders get a reminder.
- **E05-S05** As a player, I tap 'Running late (5/10/15 min)', which updates the card instead of adding a chat message.
- **E05-S06** As an organizer, I track equipment (bib sets by colour, balls) and who took them home.
- **E05-S07** As a player, I post a lost-and-found item with a photo, linked to the game.

## Acceptance criteria

- Venue changes on a published game trigger E06 change notifications.
- Each venue has an unambiguous display name plus aliases (e.g. 'Kendler', 'U3').
- Arrival info is available offline-friendly in DM (text and pin), not only in the Mini App.

## Out of scope

- Direct venue booking integrations (later, if venues expose APIs)
