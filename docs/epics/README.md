# Epics & roadmap

Each epic is also a GitHub issue labelled `epic`, with its user stories as a checklist.
Priorities: **P0** = MVP-blocking, **P1** = next, **P2** = later.

## M0 Foundations

Bot skeleton, data model, i18n uk/ru, roles, privacy, CI/CD.

| Epic | Priority | Goal |
|---|---|---|
| [E01 · Platform foundations, i18n & privacy](E01-platform-foundations.md) | P0 | A deployable Telegram bot skeleton with persistence, roles, per-user language (Ukrainian or Russian, falling back to Ukrainian), GDPR basics and observability, so every later epic builds on solid ground. |

## M1 Replace the poll

MVP: the organizer runs a full week without native polls or manual reserve or money tracking.

| Epic | Priority | Goal |
|---|---|---|
| [E02 · Players, identity, aliases & guests](E02-players-identity.md) | P0 | One stable player record per human, linked to Telegram when possible, with nicknames, roles (e.g. goalkeeper) and support for guests who aren't on Telegram. |
| [E03 · Games & one-tap signup (replace the poll)](E03-games-signup.md) | P0 | Organizers create a game in seconds (or from a recurring template); players sign up with one tap on a live game card that always shows who's in, who's waiting, and the essentials. |
| [E04 · Waitlist, priority & cancellation policy](E04-waitlist-priority-cancellation.md) | P0 | Encode the community's real fairness rules (first come, priority holds, reserve-gets-priority-next-time, cancellation cutoffs and fees) so the bot runs them instead of the organizer's memory. |
| [E05 · Venues & match-day logistics](E05-venues-matchday-logistics.md) | P0 | Every game knows exactly where it is: venue, field number, changing room, key holder, parking rules and arrival notes. Players ask the bot (or just look at the card) instead of the chat. |
| [E06 · Rescheduling, cancellation & weather go/no-go](E06-reschedule-cancel-weather.md) | P0 | Decisions about the second field, weather, holidays and low turnout are made at the right time with data, and everyone affected is notified once, clearly. |
| [E07 · Payments ledger (track only)](E07-payments-ledger.md) | P0 | A per-game, per-person ledger of what's owed and paid (cash or SEPA), with collectors, special tariffs, fees and event cost splits, so the organizer stops chasing money from memory. No money moves through Rondo. |
| [E17 · Admin management in the bot](E17-admin-management.md) | P1 | An organizer runs the whole community from a private chat with the bot, by tapping or typing. |

## M2 Know your players

History import, fair teams, results, feedback, stats.

| Epic | Priority | Goal |
|---|---|---|
| [E08 · Team balancing](E08-team-balancing.md) | P1 | Generate fair teams in seconds from real history: hidden skill ratings, goalkeeper distribution, constraints (pairs, positions), team count by headcount and bib colours. The organizer reviews and posts. |
| [E09 · Match day: formats, rotation & results](E09-matchday-formats-results.md) | P1 | Run the session on the pitch: format templates (3-team rotation, 2 or 3 fields, mini-tournament), a match timer, quick score entry per mini-game, and an auto-calculated table for the day. |
| [E10 · Post-game feedback & peer ratings](E10-post-game-feedback.md) | P1 | Two-tap feedback after every game: overall rating, MVP vote, team-balance rating, venue rating, an optional comment, and private peer ratings that improve balancing. |
| [E11 · Attendance, reliability & personal stats](E11-attendance-reliability-stats.md) | P1 | Know who plays, how often and how reliably, and give every player a personal stats page: games, streaks, wins, goals and MVPs. |
| [E15 · History import & bootstrap](E15-history-import-bootstrap.md) | P1 | Bootstrap Rondo with 3.5 years of history from the Telegram export: games, venues, line-ups mapped to players, so stats and ratings aren't empty on day one. |

## M3 Community

League squads, multi-activity, recognition, group hygiene.

| Epic | Priority | Goal |
|---|---|---|
| [E12 · Recognition & community life](E12-recognition-community.md) | P2 | Keep the social glue that makes this group special, with less manual work: birthdays, awards, hall of fame, season recap, events with cost splitting. |
| [E13 · Competitive teams, league & tournaments](E13-competitive-teams-league.md) | P2 | Support the community's league squads (main, second, veterans): fixtures, squad availability, call-ups, results and supporter turnout, separate from casual games. |
| [E14 · Multi-activity & organizer delegation](E14-multi-activity-delegation.md) | P2 | Run football, basketball, volleyball, table tennis and other activities with the same engine, each with its own defaults, and let multiple organizers and helpers share the load. |
| [E16 · Group hygiene, rules & onboarding](E16-group-hygiene-rules.md) | P2 | Keep the group readable and the rules known: onboarding for newcomers, a rules FAQ with acknowledgement, ads approval, and quieter logistics. |

## MVP definition of done (M1)

For two consecutive weeks of real games:
- every game is created from a template and filled through the Rondo game card (no native polls);
- waitlist promotions and late cancellations are handled without organizer messages;
- every player knows the venue, field and changing room from the card;
- the organizer closes each game with a complete paid/unpaid ledger.
