# ADR-0001: Architecture and stack

- **Status:** Accepted (2026-11-24)
- **Deciders:** maintainers

## Context

Rondo is a Telegram bot plus Mini App for a ~200-member community, with bursts of activity around
game times. It needs live-updating group messages, DMs, durable timers (waitlist offers, go/no-go
checkpoints, reminders), a rich organizer UI, per-user localisation (uk/ru), and a relational core
that can grow to many communities. The maintainers already run several TypeScript monorepos
(budgie, knee-doctor, suuudokuuu) with a shared toolchain; Rondo reuses it.

## Decision

**TypeScript and Effect v4 end to end.** Every service, repository, job and edge is an Effect
program composed from `Layer`s; promises exist only at foreign boundaries.

| Concern | Choice |
|---|---|
| Runtime | Node 26 (`.nvmrc`); pnpm 12 workspaces; Turborepo |
| Core library | `effect` 4.x: `Context.Service`, `Layer`, `Schema`, `Config`, `Schema.TaggedError`, `effect/FileSystem` |
| Database | PostgreSQL 18, one schema per bounded context ([data model](../architecture/data-model.md)) |
| Data access | Drizzle ORM 1.0 (`drizzle-orm/effect-postgres`) over `@effect/sql-pg`; queries are Effects; `Db` service in `@rondo/db` |
| Migrations | `drizzle-kit generate` from the TypeScript schema, plus hand-written SQL migrations for invariants Drizzle can't express (exclusion constraints, deferred triggers, role grants, materialized views; row-level security arrives with the second tenant, no epic yet) |
| Tests | Vitest 5 and `@effect/vitest`; integration tests run real SQL on in-process Postgres (PGlite served over the wire protocol with `@electric-sql/pglite-socket`), so CI needs no Docker; the PGlite test layer is exported from `@rondo/db/testing` |
| Bot | grammY behind an Effect `Telegram` service (webhook mode); updates are decoded with `Schema` |
| Durable work | Claims and receipts in Postgres, hourly and nightly jobs ([ADR 0002](0002-bot-runtime-and-assistant.md)); an outbox with workers was planned and is not built |
| Mini App and API | React and Vite with `@effect/atom-react`; Effect `HttpApi` for the typed API shared with the client; auth via signed Telegram `initData` |
| i18n | Catalogs per locale: `uk` (default), `ru`; `en` and `de` later. Language from Telegram `language_code`, falling back to `uk` |
| Ratings | `openskill` (Weng-Lin) behind a `Rating` service; private schema `play_private` |
| Weather and holidays | GeoSphere Austria API (fallback Open-Meteo); `date-holidays` (AT, Vienna) |
| Observability | Effect logger and tracer → OpenTelemetry; `/health` endpoint |
| Quality gates | oxfmt; `effect-tsgo --tsrs-lint oxlint --type-aware --deny-warnings` with local Effect rules (`lint-rules/`); knip; jscpd at threshold 0; commitlint; husky with lint-staged |
| CI/CD | GitHub Actions on GitHub-hosted `ubuntu-latest` runners: quality job (format, types, lint, dead code, duplication, tests, `drizzle-kit check`, `db:generate` leaves a clean worktree); release-please |
| Hosting | One container (bot, API, workers) plus managed Postgres in an EU region; decided in E01 |

### Telegram specifics

- **Live game card:** one message per game, edited in place and pinned while open; inline buttons In / Maybe / Out / +1 / Where? / Late.
- **Native poll fallback:** the bot can send non-anonymous polls and capture `poll_answer` updates during migration.
- **Privacy mode on:** the bot only needs commands, callbacks and mentions; admin rights only for pinning.
- **History:** a Telegram Desktop export is imported once by `@rondo/ingest-telegram` ([runbook](../runbooks/import-telegram-history.md)).

## Consequences

- One language, one effect system and one error model from the database to the Mini App.
- Postgres is the single source of truth, including claims of jobs and analytics (materialized views).
- Community-specific knowledge (organizer names, venue catalog, squad tags) lives in private config, never in code.
- Drizzle 1.0 and Effect 4 are young; versions are pinned exactly, and the 24h release quarantine (`minimumReleaseAge`) exempts only those vendor families.
