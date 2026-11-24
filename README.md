# Rondo

**The Telegram co-organizer for amateur football communities.**

Rondo runs the boring half of a pickup-football community so the organizer can play:
signups with a real waitlist, venue and match-day logistics, weather go/no-go, fair
teams, results, feedback, attendance stats and a "who paid" ledger. All of this runs inside the
Telegram group the community already lives in.

> *Rondo*: the passing circle every football session starts with. Everyone touches the ball, nobody is left out.

## Status

🏗️ **Foundation.** The product is specified from a real community: three and a half years
(Jun 2023 to Nov 2026) of history from a ~200-member Vienna group, covering about 18,000 messages,
559 game polls and 210 posted line-ups. The relational core and the history importer are built;
the bot itself comes next (milestone M1).

| Doc | What's inside |
|---|---|
| [Vision](docs/vision.md) | Problem, users, principles, success metrics |
| [Community analysis](docs/research/community-analysis.md) | What the history taught us (anonymized) |
| [Epics & roadmap](docs/epics/README.md) | 16 epics, milestones, priorities |
| [Data model](docs/architecture/data-model.md) | 12 bounded-context schemas, invariants, roles, analytics |
| [ADR-0001: Stack](docs/adr/0001-stack.md) | TypeScript + Effect v4, Postgres + Drizzle, tooling |
| [Runbook: import history](docs/runbooks/import-telegram-history.md) | Load a Telegram export into the database |
| [Glossary](docs/glossary.md) | Domain terms (EN / UK / RU) |

Epics are also tracked as GitHub issues with the `epic` label.

## Repository

```
packages/db               Drizzle schema per bounded context, migrations, Effect Db service
packages/ingest-telegram  Telegram export → database importer (Effect)
tests/test-kit            Shared Vitest configuration
docs/                     Vision, research, epics, architecture, ADRs, runbooks
```

```bash
pnpm install
pnpm db:up && pnpm db:migrate   # local Postgres 17 on :54329
pnpm check                      # format, types, lint, dead code, duplication, tests
```

## Principles (short)

1. **Telegram-native.** Players never install anything. Rich views live in a Telegram Mini App.
2. **Organizer stays in charge.** The bot proposes and automates; a human decides.
3. **Speaks the players' language.** Ukrainian or Russian based on each user's Telegram language, falling back to Ukrainian.
4. **Private by default.** Skill ratings are admin-only. GDPR (Austria/EU) is built in, not bolted on.
5. **Money is tracked, never moved.** Rondo knows who paid; it doesn't process payments.

## License

[MIT](LICENSE)
