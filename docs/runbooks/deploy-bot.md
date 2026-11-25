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

After the first production deploy, and whenever the domain, `allowed_updates` or the command list changes, register the webhook.
It also sets the commands: everyone sees `/start`; each owner from `RONDO_OWNER_TG_USER_IDS` sees
`/newgame`, `/games`, `/menu`, `/start`, `/reset`. Other admins get the same list the first time they open `/start` or `/menu`:

```bash
isec run getrondo prod -- sh -c 'RONDO_WEBHOOK_URL=https://<production-domain>/api/telegram pnpm -F @rondo/telegram webhook:set'
```

## Connect the community group

1. In @BotFather: `/setprivacy` → **Disable** for the bot, so it sees every group message.
2. Follow [add-bot-to-group](add-bot-to-group.md): the owner loads the known groups and the approver, the organizer adds the bot and
   answers it privately. Nothing is sent to a group by linking it.
3. Bots cannot list existing members, so people appear once they write, vote or join. The bot reads games only in the bound topic.
   In General, or in a group without topics, the whole group outside other topics counts.
4. Set the language of the group and the poll template once (`isec`, production database, ask the owner first).
   Placeholders: `{weekday}`, `{date}`, `{time}`, `{place}`, `{station}`, `{fields}`, `{places}`. One without a value
   disappears with the separator beside it. Without a template the bot uses a generic one. The import keeps both.

   ```sql
   update org.community
   set default_locale = 'ru',
       settings = settings || '{"poll": {"question": "{weekday}, {date}, {time} {place}, {station}!\n\n{fields}, {places}", "answers": ["+", "-"]}}'
   where slug = '<community-slug>';
   ```

   Short names and stations of the places are set through the assistant.
5. Make every organizer an admin through the assistant (they must have written in the group first). Polls, line-ups and cancellations posted by anyone else are ignored.

From then on the bot keeps sessions, line-ups and cancellations current, and admins run the community
from a private chat:

- `/newgame` opens the most likely next game as the exact poll, ready for ✅. The other likely game, the
  size row and the time, place and day buttons change it in place; 🛠 walks through day, place, time and size.
  It needs only the database and Telegram: the AI gateway is not involved.
- `/menu` (and `/start`) shows the next game; `/games` lists upcoming and recent games, each with a card to post
  its poll, change time, place or size, balance teams or cancel.
- 🔁 on the preview switches where the poll goes: a linked group, several groups (one poll, forwarded), or
  "👤 Мені, перешлю сам": the poll comes to the admin's private chat to forward by hand; votes on the copies count.
- 🗑 on the card deletes a future game made by the bot that only admins voted in, so a test leaves no statistics.
- Any other text goes to the assistant; `/reset` clears that conversation.
- A place without an address gets a "📍 Address" hint on the preview: an admin sends a location pin, a Google Maps
  link or the address, and the poll shows it with a route button.

## Back up and restore

Before a migration reaches production, take a dump with the unpooled URL and keep it until the release is stable:

```bash
isec run getrondo prod -- sh -c 'pg_dump --format=custom --file=rondo-$(date +%F).dump "$DATABASE_URL_UNPOOLED"'
```

Restore all or nothing: `--single-transaction` rolls back on the first error, `--clean --if-exists` drops what the dump recreates.

```bash
isec run getrondo prod -- sh -c 'pg_restore --clean --if-exists --single-transaction --no-owner --dbname="$DATABASE_URL_UNPOOLED" rondo-<date>.dump'
```

Ask the owner first; a restore overwrites everything written since the dump. Try it on a Neon branch before production.

Production deploys the new migration before the new code is live, so every migration must work with the previous deployment:
add nullable columns or tables, never rename or drop in the same release. A drop ships one release after the code stopped using it.

## Operate

- **Logs:** `vercel logs rondo` or the Vercel dashboard; every update and tool call is traced
  with an Effect span (`Bot.*`, `Core.*`, `Assistant.*`).
- **Webhook health:** `getWebhookInfo` shows pending updates and the last error.
- **Pending proposals:** `select * from comms.pending_action order by created_at desc`.
- **Uncertain polls:** `select id, kind, created_at from comms.pending_action where status = 'failed' and result -> 'failure' ->> 'code' = 'result_uncertain'`
  (rows before the failure codes have the text in `result ->> 'reason'`) lists actions whose send Telegram did not answer
  in time. A new game was not stored, and nothing is sent again. If its poll is in the group, delete it,
  then ask for the game again. A game with an open poll is not announced twice: if that poll was deleted in Telegram, set
  its `comms.telegram_poll.closed_at` first.
- **Audit:** `select * from audit.log order by at desc`.
- **Admin menus:** `select * from comms.admin_state` shows one row per admin with an open screen or typed input;
  rows expire after 30 minutes, and deleting one only closes that screen.
- **Import again:** see [import-telegram-history](import-telegram-history.md); stop re-importing
  once the bot has run sign-ups on imported sessions.
