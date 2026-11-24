# ADR-0001: Architecture and stack

- **Status:** Proposed (2026-11-24)
- **Deciders:** maintainers

## Context

Rondo is a Telegram bot for a ~200-member community with bursts of activity around game times
(a few hundred interactions per hour at peak). It needs rich, live-updating group messages, DMs,
scheduled jobs (reminders, decision checkpoints, auto-publishing), richer UIs for organizers
(team builder, ledger, venue registry) and per-user localisation (uk/ru).

## Decision

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript** (Node 22 LTS) | One language for bot, Mini App and shared domain types. |
| Bot framework | **grammY** | Modern, typed, first-class conversations, sessions, i18n (`@grammyjs/i18n` with Fluent), runner for concurrency, webhook-ready. |
| Mini App | **React + Vite + `@telegram-apps/sdk`** | Team builder, ledger, venue registry, stats; auth via signed `initData`. |
| API | **Hono** on the same service | Lightweight; serves the Mini App API and the Telegram webhook. |
| Database | **PostgreSQL 17 + Drizzle ORM** | Relational domain (games, signups, ledger), migrations in code, strong typing. |
| Jobs | **pg-boss** (Postgres-backed queue) | Reminders, checkpoints, waitlist timeouts without an extra Redis. |
| Ratings | **openskill** (Weng-Lin, TrueSkill-like) | Multi-team, partial-play friendly, open licence. |
| Weather | **GeoSphere Austria API**, fallback **Open-Meteo** | Austrian national service; free; no key. |
| Holidays | `date-holidays` (AT, Vienna) | Public and school holidays. |
| i18n | Fluent (`.ftl`) per locale: `uk` (default), `ru`; `en`, `de` later | Plurals and gender handled properly. |
| Monorepo | **pnpm workspaces + Turborepo**: `apps/bot`, `apps/miniapp`, `packages/domain`, `packages/db` | Shared types; fast CI. |
| Quality | Biome (lint and format), Vitest, Playwright for the Mini App | Fast local loop. |
| Hosting | One small container plus managed Postgres (e.g. Fly.io or Hetzner and Neon) | Cheap, EU region (GDPR). Decided at E01. |
| Observability | pino logs, Sentry, `/health` | Minimal but enough. |

### Telegram specifics

- **Live game card:** one message per game, edited in place (`editMessageText`) and pinned while open. Inline buttons for In / Maybe / Out / +1 / Where? / Late.
- **Native poll fallback:** the bot can send non-anonymous polls and capture `poll_answer` updates, so the community can keep the old habit during migration.
- **Privacy mode:** the bot runs with privacy mode **on**. It needs only commands, button callbacks and mentions, not the full chat. Admin rights only for pinning.
- **DMs** require the user to `/start` the bot once; onboarding (E16) drives this.

## Consequences

- Single deployable keeps operations cheap; can split the Mini App later.
- Postgres is the single source of truth (including the job queue).
- Ratings are an internal service in `packages/domain`, unit-testable and replaceable.
