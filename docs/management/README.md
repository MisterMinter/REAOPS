# REAOPS Management Guide

This guide is for the person operating REAOPS across production deployment, tenant onboarding, MLS provider setup, memory operations, review gates, channel health, troubleshooting, and incident handling.

## Operating Principles

- Prisma/Postgres is the transactional source of truth for tenants, users, listings, contacts, approvals, reviews, sync runs, audit events, agent runs, and jobs.
- GBrain is durable synthesized memory: brand direction, SOPs, decisions, summaries, gaps, stale facts, and cited context.
- MLS feeds are the primary listing source by market. HubSpot/CRM and Drive complement MLS. Zillow scraping is fallback-only and should never be treated as authoritative.
- Autonomous sends are allowed only for low-risk content after policy, permissions, channel health, quiet hours, and review gates pass.
- Production cron/webhook routes must fail closed when secrets are missing.

## First-Time Deployment

1. Provision Railway PostgreSQL and set `DATABASE_URL`.
2. Set core app secrets: `AUTH_SECRET`, `NEXTAUTH_URL`, `TOKEN_ENCRYPTION_KEY`, and at least one AI provider key.
3. Configure Google OAuth with redirect URI `https://<domain>/api/auth/callback/google` and enable Drive, Gmail, and Calendar APIs.
4. Configure optional channels: Telegram bot token/webhook secret, Buffer OAuth credentials, BlueBubbles endpoint/password, HubSpot OAuth app, and GBrain URL/API key.
5. Deploy with `npm run build`; the production start command should run `npx prisma migrate deploy && npm run start`.
6. Confirm `/api/health` and `/api/health?deep=1` are healthy or explicitly degraded only for integrations not yet enabled.
7. Register Telegram webhook against `/api/agent/telegram?secret=<TELEGRAM_WEBHOOK_SECRET>`.
8. Configure cron jobs with `Authorization: Bearer $CRON_SECRET`:
   - `/api/cron/daily-brief`
   - `/api/cron/agent-loops`
   - `/api/cron/tenant-brain`
   - `/api/cron/mls-sync`
9. Seed or create the first platform admin, then add brokerage tenants and users from the admin UI.

## Tenant Onboarding Checklist

1. Create the tenant in Admin and assign broker owner, ops manager, and agent users.
2. Confirm each user signs in with Google at least once so OAuth refresh tokens are captured.
3. In Settings, complete brokerage profile, brand kit, broker phone, disclaimer, and default tone.
4. Configure Google Drive root folder and share it with the connected Google account.
5. Add MLS provider configs for the tenant's markets; sync MLS before relying on any fallback listing source.
6. Connect HubSpot and map listing/deal fields when CRM is used.
7. Configure sending identities for Gmail, Telegram, BlueBubbles, and Buffer as applicable.
8. Run GBrain memory backfill and verify citations/gaps in the tenant portal.
9. Configure approval policy and reviewer authority.
10. Check go-live readiness: active tenant/users, Drive root, MLS or CRM listings, review gates, channel health, cron secret, and no recent failed jobs.
11. Run a demo flow: daily brief, marketing pack, review queue item, Drive doc, Gmail draft, text draft, and social draft.

## Adding MLS Providers

REAOPS now has an MLS provider registry in `src/lib/mls`. Every provider must implement the same contract: list provider metadata, accept a tenant-scoped config/secret, return normalized listing facts, and never bypass tenant scoping.

To add a provider:

1. Add the provider key to `MlsProviderKey` in `src/lib/mls/types.ts`.
2. Add a provider entry in `src/lib/mls/registry.ts` with label, description, config help, and `sync()`.
3. Normalize provider rows into `MlsListingInput`. Required fields are `externalId` and `address`.
4. Store secrets only through Settings; they are encrypted in `MlsProviderConfig.secretRef`.
5. Add unit tests for row normalization, auth header behavior, and error handling.
6. Add tenant configs in Settings, one per MLS market/board.
7. Run `/api/cron/mls-sync` or use Settings "Sync now" and confirm `CachedListing.hubspotId` values start with `mls:<providerKey>:`.
8. Confirm Marketing shows `MLS` or `MLS + Drive` badges and Drive auto-linking works.

Use the existing providers as scaffolds:

- `manual-json`: temporary operational bridge for JSON exports while a real provider adapter is being built.
- `generic-reso-web-api`: starting point for RESO/OData MLS APIs that expose `Property` resources.

## Zillow Fallback Policy

Use Zillow only when MLS, HubSpot/CRM, and Drive cannot provide enough listing context. Zillow imports use `zillow:` source IDs and should be labeled as fallback in UI, prompts, and operator runbooks. If Zillow conflicts with MLS or CRM, MLS/CRM wins. Respect site terms and expect intermittent 403s from hosted environments.

## GBrain Memory Operations

- Backfill after tenant onboarding, major brand-kit changes, SOP changes, or large CRM/listing imports.
- Scheduled memory maintenance runs through `/api/cron/tenant-brain`.
- Do not ingest raw Gmail, Telegram, SMS/iMessage, or full meeting transcripts in this wave.
- Inspect memory health, stale facts, failed ingests, and citations before enabling higher autonomy.
- When approving/rejecting content, capture the decision so GBrain learns tenant-specific brand and compliance direction.

## Review Gates And Approvals

Outbound or publishable content must pass review before sending, publishing, or saving externally. This includes Gmail, BlueBubbles, Telegram outbound, Buffer posts, flyers, Drive docs, MLS copy, and campaign assets.

- `PASS`: eligible for low-risk auto-send if policy and channel checks also pass.
- `NEEDS_HUMAN`: creates an approval item and waits for reviewer action.
- `BLOCK`: cannot auto-send, publish, or save externally; creates a durable review/compliance item with reasons and suggested revisions.

Reviewer workflow: open portal review queue, compare original and suggested revisions, approve/reject/revise, then confirm the decision is written back to audit logs and GBrain.

## Daily Operations

- Review daily broker brief for stale follow-ups, pending approvals, campaign gaps, compliance flags, recent changes, and stale/missing information.
- Check `/api/health?deep=1` after deploys and before go-live.
- Review failed `JobRun` and `SyncRun` records.
- Confirm Telegram delivery for notifications.
- Keep MLS syncs green before running marketing campaigns.
- Review auto-send audit events weekly.

## Troubleshooting

### Health endpoint reports missing secret
Set the missing env var in Railway and redeploy. Production cron/webhook routes intentionally return 503 if required secrets are absent.

### MLS sync returns no listings
Confirm provider config is enabled, endpoint is reachable, token is valid, and query filters are not too narrow. For RESO, test without a custom `$filter`, then add market/status filters once rows return.

### Drive folders are not linked to listings
Confirm the Drive root folder is shared, at least one tenant user has a valid Google refresh token, and folder names contain recognizable street addresses. Run MLS/CRM sync first, then reload Marketing to trigger auto-linking.

### GBrain is down
Agents degrade to Prisma/current chat context and record memory failure. Restore GBrain service, run health check, then run backfill/maintenance for affected tenants.

### Review gate blocks expected content
Inspect review reasons and source facts. Fix unsupported claims, missing disclaimers, fair-housing language, or stale brand guidance. If the rule is too strict, update the review pipeline tests before relaxing it.

### Telegram commands are not received
Check `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, webhook registration URL, and recent route logs for 401/503 responses.

### Gmail or Drive actions fail
Have the user sign out/in with Google, confirm OAuth scopes, verify APIs are enabled in Google Cloud, and check token refresh errors.

### BlueBubbles fails
Run the Settings health check, confirm base URL/password, verify the Mac mini is online, and inspect tenant channel account errors.

## Backup, Rotation, And Incidents

- Back up Postgres before migrations and major tenant imports.
- Rotate `TOKEN_ENCRYPTION_KEY` only with a planned re-encryption process; changing it without migration makes stored tokens unreadable.
- Rotate channel secrets when staff leave or when provider credentials are exposed.
- For suspected cross-tenant access, pause autonomous sends, disable affected tenant integrations, preserve audit logs, and inspect tenant-scoped resolver paths before re-enabling.
- For bad outbound content, mark the approval/review item, notify the broker owner, capture the correction in GBrain, and add a regression test if the review gate missed it.

## Release Checklist

1. `npx prisma generate`
2. `npm run test`
3. `npx tsc --noEmit`
4. `npm run build`
5. Review migrations and env validation output.
6. Deploy to Railway and run migrations.
7. Check `/api/health?deep=1`.
8. Run a seeded tenant smoke flow.
9. Confirm cron routes and Telegram webhook.
10. Commit and push the release checkpoint.
