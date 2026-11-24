# E14 · Multi-activity & organizer delegation

**Milestone:** M3 Community · **Priority:** P2

## Goal

Run football, basketball, volleyball, table tennis and other activities with the same engine, each with its own defaults, and let multiple organizers and helpers share the load.

## Evidence from the community

- The same group runs basketball, beach and indoor volleyball, table tennis and boxing, each with its own caps and prices.
- Stand-in organizers took over when the main organizer was away; cash collection was delegated per game.

## User stories

- **E14-S01** As an owner, I define activities (football, basketball, …) with defaults: team size, formats, caps, price, rating model on or off.
- **E14-S02** As a player, I follow only the activities I care about and get notifications only for those.
- **E14-S03** As an owner, I appoint organizers per activity and helpers per game.
- **E14-S04** As an organizer, I hand over a game to a stand-in with one action; they get full control and context.
- **E14-S05** As an owner, I run multiple Telegram groups (e.g. a separate basketball chat) under one community.

## Acceptance criteria

- Activity is a first-class dimension in every entity: games, ratings, stats, prices.
- Permissions are evaluated per community, per activity and per game.

## Out of scope

- Multi-tenant SaaS billing (later)
