# RE Agent OS

AI-powered real estate brokerage assistant. An agentic backend built on Next.js and the Vercel AI SDK that gives brokers and agents access to property management, marketing generation, calendar scheduling, follow-up drafting, and portfolio analysis through natural language — via **Telegram bot** (primary) or **web chat** (fallback).

## What it does

- **Google Drive** — List, search, move files, and create Google Docs across a shared Drive folder tree organized by listing address.
- **Property listings** — Search and inspect cached listings sourced from Drive folders, HubSpot sync, or Zillow profile scraping.
- **Marketing generation** — Generate MLS descriptions, Instagram captions, email subject lines, and social card copy from listing facts and hero photos, then save results as Docs in Drive.
- **Google Calendar** — List upcoming events, create showings / open houses, and add attendees.
- **Follow-ups** — Draft email and SMS follow-up copy for leads and contacts; create calendar reminders for outreach.
- **Portfolio analysis** — Summarize active listings by status, flag high days-on-market properties, suggest priority actions, and generate a daily brief.
- **Buffer** — Create social media drafts (stub — OAuth integration planned for Phase 2).
- **Zillow** — Scrape public Zillow profile pages to import listing links (best-effort; datacenter IPs are often blocked).

The agent runs a multi-step loop (`generateText` with `tools` + `maxSteps`) so it can chain tool calls autonomously — e.g. look up a listing, pull its photos from Drive, generate a marketing pack, and save the result back as a Doc, all from a single user message.

## Architecture

```
Telegram ──webhook──▸ /api/agent/telegram ──▸ AgentCore
Web Chat ──fetch───▸ /api/agent/chat     ──▸ AgentCore
                                               │
                                          ToolRegistry
                                               │
               ┌───────┬───────┬──────┬────────┼────────┬──────────┬────────┐
             Drive  Listings Zillow Marketing Buffer Calendar Follow-up Analysis
```

- **Agent core** — `src/agent/core.ts` orchestrates the Vercel AI SDK loop, loads per-user context, and persists conversations.
- **Skills** — `src/agent/skills/*.ts` — each file exports tool definitions (Zod schemas + execute functions).
- **System prompt** — `src/agent/system-prompt.ts` — built dynamically from tenant data, Drive config, listing counts, and user role.
- **AI providers** — Gemini 2.0 Flash (preferred), Claude, or GPT-4o-mini, configurable via `AI_PROVIDER` env var.

## Local development

```bash
cp .env.example .env   # fill in values
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

**Minimum env vars:** `DATABASE_URL`, `AUTH_SECRET`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and at least one AI key (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY`).

Google sign-in only works for emails already in the `User` table. The seed creates the first platform admin. Add others under **Admin → Users** before they sign in.

### Google OAuth scopes

The app requests: `openid`, `email`, `profile`, `drive` (full), `calendar`, `gmail.compose`. Enable the **Drive API**, **Calendar API**, and **Gmail API** in your GCP project.

### Telegram bot (optional for local dev)

1. Create a bot via [@BotFather](https://t.me/BotFather) and get the token.
2. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` in `.env`.
3. Expose your local server (e.g. ngrok) and register the webhook:
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<YOUR_URL>/api/agent/telegram?secret=<SECRET>
   ```

## Production (Railway)

- **PostgreSQL** — provision and set `DATABASE_URL`.
- **`NEXTAUTH_URL`** — `https://reaops.com` (or your Railway URL before the custom domain).
- **Google Cloud Console** — authorized redirect URI: `https://reaops.com/api/auth/callback/google`.
- **AI keys** — set at least one of `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.
- **Telegram** — set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`, then register the webhook pointing to `https://reaops.com/api/agent/telegram?secret=<SECRET>`.
- **Build:** `npm run build`
- **Start:** `npx prisma migrate deploy && npm run start`

### Tenant logos

Stored in the database as a **data URL** (PNG, JPEG, WebP, or GIF, ~400 KB max).
