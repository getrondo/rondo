# Runbook: deploy and operate the bot

The bot is the Next.js app in `apps/web`, deployed to the Vercel project `rondo`
(Git-connected to `getrondo/rondo`: `main` → production, pull requests → previews).

## Secrets

All values live in Infisical project `getrondo` (`prod`, `dev`); never paste them anywhere else.

| Name | Where | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Vercel production | Bot API token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Vercel production | Checked against Telegram's `X-Telegram-Bot-Api-Secret-Token` |
| `CRON_SECRET` | Vercel production | Bearer token Vercel Cron sends to `/api/cron/maintenance` |
| `RONDO_OWNER_TG_USER_IDS` | Vercel production | Comma-separated Telegram user ids with full admin rights |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Neon integration, production only | Pooled runtime URL; unpooled URL for migrations |

The AI Gateway authenticates with Vercel OIDC on deployments; set `AI_GATEWAY_API_KEY` only
for local runs.

To copy a secret from Infisical to Vercel without printing it:

```bash
isec run getrondo prod -- sh -c 'printf %s "$CRON_SECRET" | vercel env add CRON_SECRET production --sensitive --yes'
```

## Deploy

Merging to `main` deploys production. The production build first runs
`pnpm -F @rondo/db db:migrate` against the unpooled Neon URL, then builds the app.

After the first production deploy (or when the domain changes), register the webhook:

```bash
isec run getrondo prod -- sh -c 'RONDO_WEBHOOK_URL=https://<production-domain>/api/telegram pnpm -F @rondo/telegram webhook:set'
```

## Connect the community group

1. In @BotFather: `/setprivacy` → **Disable** for the bot, so it sees every group message.
2. Add the bot to the group as an admin: Telegram sends reliable join and leave updates only to admin bots.
   Bots cannot list existing members, so people appear once they write, vote or join.
3. An owner sends `/link <community-slug>` in the group (the slug from the import config).

4. Make every organizer an admin through the assistant (they must have written in the group first). Polls, line-ups and cancellations posted by anyone else are ignored.

From then on the bot keeps sessions, line-ups and cancellations current, and admins can talk to
it privately. `/start` shows examples; `/reset` clears the conversation.

## Operate

- **Logs:** `vercel logs rondo` or the Vercel dashboard; every update and tool call is traced
  with an Effect span (`Bot.*`, `Core.*`, `Assistant.*`).
- **Webhook health:** `getWebhookInfo` shows pending updates and the last error.
- **Pending proposals:** `select * from comms.pending_action order by created_at desc`.
- **Audit:** `select * from audit.log order by at desc`.
- **Import again:** see [import-telegram-history](import-telegram-history.md); stop re-importing
  once the bot has run sign-ups on imported sessions.
