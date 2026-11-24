# ADR-0002: Bot runtime on Vercel and an AI assistant for admins

- **Status:** Accepted (2026-11-24)
- **Deciders:** maintainers

## Context

The first bot release has to (1) keep the database current from the live group, (2) let admins
run the community from a private chat in plain Ukrainian or Russian, and (3) start running games
itself: sign-up polls with a waitlist, rescheduling, venue moves, cancellations and balanced
line-ups. It must be cheap to run for a ~200-member group with bursty traffic around game times.

## Decision

| Concern | Choice |
|---|---|
| Hosting | Vercel (Fluid compute) running `apps/web`, a Next.js 16 app that only exposes route handlers today and can host the admin web UI later |
| Telegram | Webhook `POST /api/telegram`, authenticated with Telegram's `secret_token` header; the update is acknowledged immediately and handled in `after()`. Outgoing calls go through grammY's `Api` wrapped in the Effect `Telegram` service |
| Idempotency | `comms.processed_update` claims every `update_id` once, so Telegram retries never double-apply |
| Database | Neon Postgres 17 (Vercel Marketplace, Frankfurt). Pooled URL at runtime; the unpooled URL runs migrations during production builds only |
| AI | AI SDK 7 through the Vercel AI Gateway (`AiGateway` Effect service, OIDC auth on Vercel). Model `anthropic/claude-haiku-5.5` with gateway fallback to `anthropic/claude-haiku-4.5` |
| Assistant safety | The model reads through typed tools and writes **only** by creating `comms.pending_action` proposals. The bot renders each proposal from the stored payload (never from model text) with ✅/❌ buttons; only the requesting admin can confirm, proposals expire after 30 minutes, and every executed change is written to `audit.log` |
| Admin access | Owners from `RONDO_OWNER_TG_USER_IDS`; further admins are `org.role_grant` rows (`owner`/`organizer`) granted through a confirmed assistant action |
| Live listener | Group messages reuse the importer's extractors (polls, line-ups, organizer cancellations); message bodies are still never stored |
| Sign-ups | The bot posts non-anonymous native polls (✅ play / 🧤 goalkeeper / ❌ out), because Telegram only reports votes on polls the bot sent. Capacity overflow goes to the waitlist; a freed seat promotes the earliest waiting player and mentions them in the group |
| Team balancing | Snake draft by confidential organizer level (1–10, default 5), keepers spread first, then pairwise swaps that minimise the strength spread |
| Scheduled work | Daily Vercel Cron `GET /api/cron/maintenance` (bearer `CRON_SECRET`): expire proposals, finish past games (attendance from sign-ups, close polls), prune update and chat history, refresh analytics |
| Player merges | `identity.merge_person()` moves every single-column foreign key to the surviving person, drops rows that would duplicate a unique key, leaves append-only history intact and keeps a tombstone (`merged_into_person_id`) |

## Consequences

- One deployable for webhook, cron and future UI; no long-lived worker to operate.
- Cron on the Hobby plan runs daily; minute-level timers (waitlist offers with deadlines, go/no-go
  checkpoints) need Vercel Queues/Workflow or a Pro plan, tracked in E04/E06.
- The assistant cannot act without a human tap, so a wrong model answer costs a ❌, not data.
- Fixtures and prices are not read live yet; league results still come from imports (follow-up).
