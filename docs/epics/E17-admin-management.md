# E17 · Admin management in the bot

**Milestone:** M1 Replace the poll · **Priority:** P1 · **Issue:** #19

## Goal

An organizer runs the whole community from a private chat with the bot, by tapping or typing, without a website or database access.

## Principles

- Buttons and the AI assistant build the same actions, authorized, scoped and audited in one place. Menus work when the model is down.
- Group-visible and non-idempotent writes are confirmed; idempotent private edits run at once.
- Admin access is checked by Telegram user id on every tap. Player levels never reach the group.

## Stories

- **A1, games:** #20 authorization, #22 menu and home, #21 sign-up lock and roster actions, #23 typed input, #24 game card, #25 new game.
- **A2, people:** #26 players, #27 name clean-up, #28 admins, #29 attendance.
- **B:** #30 history and undo, #31 daily digest, #32 assistant evals.

## Out of scope

- Recurring games (E03-S02), venue registry (E05-S01), activity settings (E14), weather checkpoints (E06-S01)
- The live group roster (#33, E03-S07)
