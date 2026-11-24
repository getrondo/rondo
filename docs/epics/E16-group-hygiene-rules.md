# E16 · Group hygiene, rules & onboarding

**Milestone:** M3 Community · **Priority:** P2

## Goal

Keep the group readable and the rules known: onboarding for newcomers, a rules FAQ with acknowledgement, ads approval, and quieter logistics.

## Evidence from the community

- Rules (footwear, tackles, ball retrieval, swearing, payment, cancellation) are announced in long posts and repeated; newcomers miss them.
- Ads require organizer approval and become paid in 2027; classifieds and banter drown game info, so people mute the group.

## User stories

- **E16-S01** As a newcomer, when I join I get a DM: welcome, how games work, rules, venues, how to sign up, and I acknowledge the rules.
- **E16-S02** As an organizer, I maintain versioned rules; changes are announced and players re-acknowledge them.
- **E16-S03** As a member, I submit an ad through the bot; the organizer approves it (and marks it paid or free); the bot posts it with an #ad tag.
- **E16-S04** As an organizer, I see members who haven't played for N months and can send them a 'still interested?' DM.
- **E16-S05** As a member, `/faq` answers common questions (where, when, price, rules).

## Acceptance criteria

- The bot needs admin rights only for the features that require them (pinning, deleting); it degrades gracefully without them.
- Nothing is deleted automatically without a configured rule and an audit entry.

## Out of scope

- AI moderation of banter
