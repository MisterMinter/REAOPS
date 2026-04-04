# RE Agent OS — Product Requirements Document (V1)

**Version:** 1.0
**Date:** April 3, 2026
**Author:** Feroz (Product Owner / Admin)
**Status:** Ready for implementation

---

## 1. Product Overview

### What It Is
RE Agent OS is a multi-tenant SaaS platform that gives real estate brokerages AI-powered operational workflows. It connects to a brokerage's existing tools (HubSpot, Google Workspace, social scheduling) and uses Claude to automate marketing copy, client follow-ups, compliance review, and day-to-day business intelligence.

### What We're Building in V1
Two fully functional workflows with real integrations, real auth, and a multi-tenant architecture that supports onboarding additional brokerages:

1. **Listing Marketing Pack** — Pull listings from HubSpot, pull photos from Google Drive, generate MLS descriptions / social captions / email subject lines with Claude, push approved content to Buffer for scheduling.
2. **Broker Assistant** (chat) — Conversational AI agent with real-time context from the broker's HubSpot data (listings, contacts, pipeline, tasks). Answers questions, generates reports, drafts communications.

### V2 Planned (architecture must accommodate, do not implement)
3. Post-Showing Follow-Up — automated email/SMS drafts after showings
4. Compliance Pipeline — document review against brokerage SOPs
5. Social calendar with automated scheduling
6. Email/SMS sending via Brevo or Resend

### Product Name & Branding
- Product name: **RE Agent OS**
- Each tenant displays the RE Agent OS brand alongside the broker's own logo
- Broker logo is configured per-tenant in admin settings (uploaded image URL)
- The topbar shows: `[Broker Logo] RE Agent OS`

---

## 2. Architecture

### Stack

| Layer | Technology | Hosting |
|-------|-----------|---------|
| Frontend | Next.js 14+ (App Router) | Railway |
| Backend/API | Next.js API Routes (same app) | Railway |
| Database | PostgreSQL 15+ | Railway (managed) |
| ORM | Prisma | — |
| Auth | NextAuth.js v5 with Google OAuth provider | — |
| AI | Anthropic Claude API (claude-sonnet-4-6) | — |
| File Storage | Google Drive (broker's own) | — |
| CRM | HubSpot API v3 | — |
| Social Scheduling | Buffer API v1 | — |
| CSS/Styling | Tailwind CSS + design tokens from existing demo | — |

### Monorepo Structure

```
re-agent-os/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # Root layout, auth provider wrapper
│   │   ├── page.tsx                   # Landing/login page
│   │   ├── (auth)/
│   │   │   └── login/page.tsx         # Login page with Google OAuth
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx             # Authenticated layout (topbar, sidebar)
│   │   │   ├── marketing/
│   │   │   │   └── page.tsx           # Listing Marketing Pack workflow
│   │   │   ├── assistant/
│   │   │   │   └── page.tsx           # Broker Assistant chat
│   │   │   └── settings/
│   │   │       └── page.tsx           # User/tenant settings
│   │   ├── admin/
│   │   │   ├── layout.tsx             # Admin-only layout
│   │   │   ├── tenants/page.tsx       # Manage brokerages
│   │   │   ├── users/page.tsx         # Manage users across tenants
│   │   │   └── activity/page.tsx      # Activity log
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       ├── claude/
│   │       │   └── stream/route.ts    # Claude streaming proxy
│   │       ├── hubspot/
│   │       │   ├── connect/route.ts   # OAuth initiation
│   │       │   ├── callback/route.ts  # OAuth callback
│   │       │   ├── listings/route.ts  # Fetch listings
│   │       │   ├── contacts/route.ts  # Fetch contacts
│   │       │   └── tasks/route.ts     # Create tasks
│   │       ├── drive/
│   │       │   ├── folders/route.ts   # List folders
│   │       │   └── photos/route.ts    # List photos in a folder
│   │       ├── buffer/
│   │       │   ├── connect/route.ts   # OAuth initiation
│   │       │   ├── callback/route.ts  # OAuth callback
│   │       │   └── queue/route.ts     # Push post to Buffer
│   │       └── admin/
│   │           ├── tenants/route.ts
│   │           └── users/route.ts
│   ├── lib/
│   │   ├── auth.ts                    # NextAuth config
│   │   ├── prisma.ts                  # Prisma client singleton
│   │   ├── hubspot.ts                 # HubSpot API helpers
│   │   ├── drive.ts                   # Google Drive API helpers
│   │   ├── buffer.ts                  # Buffer API helpers
│   │   ├── claude.ts                  # Claude streaming helper
│   │   ├── permissions.ts             # Role-based access control
│   │   └── context-builder.ts         # Builds Claude system prompt from real data
│   ├── components/
│   │   ├── ui/                        # Shared UI primitives
│   │   ├── topbar.tsx
│   │   ├── workflow-nav.tsx
│   │   ├── listing-selector.tsx
│   │   ├── drive-photo-picker.tsx
│   │   ├── marketing-output.tsx
│   │   ├── listing-template-card.tsx
│   │   ├── chat-interface.tsx
│   │   └── admin/
│   │       ├── tenant-form.tsx
│   │       └── user-table.tsx
│   ├── hooks/
│   │   ├── use-listings.ts
│   │   ├── use-drive-photos.ts
│   │   ├── use-claude-stream.ts
│   │   └── use-hubspot-context.ts
│   └── styles/
│       └── tokens.css                 # Design tokens ported from demo
├── public/
│   └── ...
├── .env.example
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── railway.json
```

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://...

# Auth (Google OAuth - YOUR project, not broker's)
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
NEXTAUTH_URL=https://your-app.railway.app
NEXTAUTH_SECRET=random-32-char-secret

# Google Service Account (for Drive access)
GOOGLE_SERVICE_ACCOUNT_EMAIL=sa@your-project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# HubSpot (your developer app)
HUBSPOT_CLIENT_ID=your-hubspot-app-client-id
HUBSPOT_CLIENT_SECRET=your-hubspot-app-client-secret

# Buffer (your developer app)
BUFFER_CLIENT_ID=your-buffer-app-client-id
BUFFER_CLIENT_SECRET=your-buffer-app-client-secret
```

---

## 3. Database Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Multi-tenancy ───────────────────────────────────────────

model Tenant {
  id              String   @id @default(cuid())
  name            String                          // "Atlanta Premier Realty"
  slug            String   @unique                // "atlanta-premier"
  logoUrl         String?                         // Uploaded broker logo
  brokerageName   String?                         // Display name for branding
  isActive        Boolean  @default(true)

  // Integration config
  hubspotTokens   HubSpotTokens?
  bufferTokens    BufferTokens?
  driveConfig     DriveConfig?

  // HubSpot data model config
  // Set after inspecting how this broker uses HubSpot
  hubspotListingObject   String  @default("deals")   // "deals" or "custom_object_name"
  hubspotListingProps    Json?                        // Map of property names to our fields

  // Preferences
  defaultTone     String   @default("Warm but professional. First-name basis. No pressure.")
  complianceStandard String @default("ga_residential")

  users           User[]
  activityLogs    ActivityLog[]
  cachedListings  CachedListing[]
  cachedContacts  CachedContact[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model HubSpotTokens {
  id            String   @id @default(cuid())
  tenantId      String   @unique
  tenant        Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  accessToken   String                    // Encrypted at rest
  refreshToken  String                    // Encrypted at rest
  expiresAt     DateTime
  hubId         String                    // HubSpot portal ID
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model BufferTokens {
  id            String   @id @default(cuid())
  tenantId      String   @unique
  tenant        Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  accessToken   String                    // Encrypted at rest
  refreshToken  String?
  expiresAt     DateTime?
  profileIds    Json?                     // Connected Buffer profile/channel IDs
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model DriveConfig {
  id              String   @id @default(cuid())
  tenantId        String   @unique
  tenant          Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  rootFolderId    String                  // Shared Google Drive folder ID
  folderMapping   Json?                   // Optional: { "147 Maple Creek": "folder_id_abc" }
  // If folderMapping is null, app auto-discovers subfolders by name match
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

// ─── Users & Roles ───────────────────────────────────────────

enum UserRole {
  ADMIN          // You (Feroz). Full access to all tenants.
  BROKER_OWNER   // Brokerage owner. Full access to their tenant.
  AGENT          // Individual agent. Access to assigned listings only.
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  image         String?                   // Google profile photo
  role          UserRole  @default(AGENT)

  tenantId      String?                   // null for ADMIN (cross-tenant)
  tenant        Tenant?   @relation(fields: [tenantId], references: [id])

  // Agent-specific: which listings they can access
  // null = all listings (BROKER_OWNER default)
  // JSON array of listing IDs = restricted access
  assignedListings Json?

  lastLoginAt   DateTime?
  isActive      Boolean   @default(true)

  activityLogs  ActivityLog[]
  chatSessions  ChatSession[]

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

// ─── Cached HubSpot Data ─────────────────────────────────────
// Refreshed every 15 minutes via background job

model CachedListing {
  id              String   @id @default(cuid())
  tenantId        String
  tenant          Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  hubspotId       String                  // HubSpot record ID
  address         String
  shortAddress    String                  // "147 Maple Creek Dr"
  city            String
  state           String
  zip             String?
  beds            Int?
  baths           Float?
  sqft            Int?
  price           Int?                    // In cents
  priceDisplay    String                  // "$485,000"
  status          String                  // "Active", "Under Contract", "Closed", etc.
  daysOnMarket    Int?
  features        String?                 // Key features text
  notes           String?                 // Agent notes
  mlsNumber       String?
  driveFolderId   String?                 // Matched Google Drive folder for photos
  rawData         Json                    // Full HubSpot record for context building
  lastSyncedAt    DateTime
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([tenantId, hubspotId])
  @@index([tenantId])
}

model CachedContact {
  id              String   @id @default(cuid())
  tenantId        String
  tenant          Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  hubspotId       String
  firstName       String?
  lastName        String?
  email           String?
  phone           String?
  leadStatus      String?                 // "hot", "warm", "long-term"
  lastContactDate DateTime?
  associatedDeals Json?                   // Array of deal IDs
  notes           String?
  rawData         Json
  lastSyncedAt    DateTime
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([tenantId, hubspotId])
  @@index([tenantId])
}

// ─── Chat Sessions ───────────────────────────────────────────

model ChatSession {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  messages    Json      // Array of { role, content, timestamp }
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}

// ─── Activity Log ────────────────────────────────────────────

model ActivityLog {
  id          String   @id @default(cuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  userId      String?
  user        User?    @relation(fields: [userId], references: [id])
  action      String                     // "marketing.generate", "chat.message", "buffer.queue", etc.
  details     Json?                      // Action-specific metadata
  createdAt   DateTime @default(now())

  @@index([tenantId, createdAt])
}
```

---

## 4. Authentication & Authorization

### Google OAuth Flow

RE Agent OS uses a single Google Cloud project owned by the platform operator (you). Brokers sign in with their existing Google Workspace email. No Google Cloud project is needed on the broker's side.

**Setup (one-time):**
1. Create a Google Cloud project
2. Enable Google OAuth consent screen (External user type)
3. Add scopes: `openid`, `email`, `profile`
4. Create OAuth 2.0 Client ID (Web Application type)
5. Set redirect URI: `https://your-app.railway.app/api/auth/callback/google`

**Login flow:**
1. User clicks "Sign in with Google"
2. Google OAuth redirects to your app
3. NextAuth creates or matches a User record
4. If user's email is not in the User table with `isActive: true`, reject with "Access denied - contact your administrator"
5. If user exists and is active, create session and redirect to dashboard

**Key rule:** Users must be pre-created in the database by an admin before they can log in. This prevents random Google users from accessing the app. The Google OAuth is purely for authentication, not registration.

### Role-Based Access Control

```typescript
// src/lib/permissions.ts

type Permission =
  | 'marketing.view'
  | 'marketing.generate'
  | 'marketing.publish'        // Push to Buffer
  | 'assistant.chat'
  | 'settings.view'
  | 'settings.edit'
  | 'settings.integrations'    // Connect HubSpot, Buffer, Drive
  | 'admin.tenants'
  | 'admin.users'
  | 'admin.activity';

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  ADMIN: [
    // Everything
    'marketing.view', 'marketing.generate', 'marketing.publish',
    'assistant.chat',
    'settings.view', 'settings.edit', 'settings.integrations',
    'admin.tenants', 'admin.users', 'admin.activity',
  ],
  BROKER_OWNER: [
    'marketing.view', 'marketing.generate', 'marketing.publish',
    'assistant.chat',
    'settings.view', 'settings.edit', 'settings.integrations',
  ],
  AGENT: [
    'marketing.view', 'marketing.generate',
    // Cannot publish to Buffer
    'assistant.chat',
    'settings.view',
    // Cannot edit settings or manage integrations
  ],
};
```

**Enforcement:** Every API route and server component checks the user's role and tenant. Agents can only see listings in their `assignedListings` array (or all listings if the array is null/empty, which BROKER_OWNER defaults to).

### Tenant Isolation

Every database query includes a `tenantId` filter. An ADMIN user can switch between tenants. BROKER_OWNER and AGENT users only see data for their own tenant. This is enforced at the query level in every API route.

```typescript
// Pattern used in every API route:
const session = await getServerSession(authOptions);
const user = await prisma.user.findUnique({ where: { id: session.user.id } });

if (user.role === 'ADMIN') {
  // Use tenantId from query param or session selection
} else {
  // Always use user.tenantId, ignore any tenantId in request
}
```

---

## 5. Integration: Google Drive (Listing Photos)

### How It Works

A Google Service Account (owned by the platform, not the broker) is granted read access to the broker's shared Google Drive folder. The broker shares their listing photos folder with the service account's email address.

### Setup Per Tenant

1. Broker creates a top-level folder in Google Drive (e.g., "Listing Photos")
2. Inside it, one subfolder per property (e.g., "147 Maple Creek Dr")
3. Broker shares the top-level folder with the service account email: `sa@your-project.iam.gserviceaccount.com` (Viewer access is sufficient)
4. Admin stores the folder ID in `DriveConfig.rootFolderId`

### Folder-to-Listing Matching

When a listing is selected, the app needs to find the corresponding photo folder. Two strategies:

**Strategy 1: Auto-match by name (default)**
The app lists subfolders in the root folder and fuzzy-matches against the listing's short address. "147 Maple Creek Dr" matches a folder named "147 Maple Creek" or "147_Maple_Creek_Dr". Use a simple normalized string comparison (lowercase, strip punctuation, compare first N chars or street number + first word of street name).

**Strategy 2: Manual mapping**
Admin or broker manually maps a Drive folder ID to each listing in the settings. Stored in `DriveConfig.folderMapping` as JSON.

Use Strategy 1 as default, fall back to manual if auto-match fails. Show an "unmapped" indicator on listings with no matched folder.

### API Endpoints

**GET /api/drive/folders**
Returns list of subfolders in the tenant's root Drive folder. Used for the settings page and manual mapping.

**GET /api/drive/photos?folderId=xxx**
Returns list of image files in the specified folder. Each file includes:
- `id` (Drive file ID)
- `name` (filename)
- `mimeType`
- `size`
- `thumbnailUrl` (Drive thumbnail, 220px)
- `fullUrl` (proxied through our API to avoid CORS issues)

**GET /api/drive/image/[fileId]**
Proxies the actual image file from Google Drive. This avoids CORS issues and keeps the service account credentials server-side. Returns the image with appropriate cache headers.

### Technical Notes

- Use the `googleapis` npm package with service account auth
- Scopes needed: `https://www.googleapis.com/auth/drive.readonly`
- The service account does NOT need domain-wide delegation for this use case (it only needs the shared folder, not the broker's entire Drive)
- Cache folder listings for 5 minutes to reduce API calls
- Image proxy should set `Cache-Control: public, max-age=3600`

---

## 6. Integration: HubSpot (Listings & Contacts)

### How It Works

Each broker connects their HubSpot account via OAuth. The app stores access/refresh tokens per tenant and uses them to pull listing and contact data.

### HubSpot Developer App Setup (one-time)

1. Create a HubSpot developer account
2. Create an app
3. Required scopes: `crm.objects.deals.read`, `crm.objects.contacts.read`, `crm.objects.custom.read` (if using custom objects)
4. Set redirect URI: `https://your-app.railway.app/api/hubspot/callback`

### OAuth Flow

1. Broker clicks "Connect HubSpot" in settings
2. App redirects to HubSpot OAuth URL with tenant-specific state parameter
3. Broker authorizes
4. HubSpot redirects back with auth code
5. App exchanges code for access + refresh tokens
6. Tokens stored in `HubSpotTokens` table (encrypted)

### Data Sync

A background job runs every 15 minutes per tenant:

1. Refresh the access token if expired (HubSpot tokens expire every 30 minutes)
2. Fetch all deals (or custom objects) and upsert into `CachedListing`
3. Fetch all contacts and upsert into `CachedContact`
4. Update `lastSyncedAt` timestamps

**Implementation:** Use a cron-like approach with `setInterval` in the Next.js server process, or use Railway's cron job feature. For V1 with one tenant, a simple interval is fine.

### HubSpot Data Model Flexibility

Since we don't know yet how the pilot broker structures their HubSpot, the schema must be flexible:

```typescript
// src/lib/hubspot.ts

interface HubSpotFieldMapping {
  // Maps our internal field names to the broker's HubSpot property names
  address: string;        // e.g., "address" or "property_address"
  city: string;           // e.g., "city" or "property_city"
  state: string;
  zip: string;
  beds: string;           // e.g., "bedrooms" or "num_bedrooms"
  baths: string;
  sqft: string;
  price: string;          // e.g., "amount" (deals) or "list_price"
  status: string;         // e.g., "dealstage" or "listing_status"
  features: string;
  notes: string;
  mlsNumber: string;
}

// Default mapping for standard HubSpot Deals
const DEFAULT_DEAL_MAPPING: HubSpotFieldMapping = {
  address: 'address',       // Custom property on deal
  city: 'city',
  state: 'state',
  zip: 'zip',
  beds: 'bedrooms',
  baths: 'bathrooms',
  sqft: 'square_footage',
  price: 'amount',          // Standard deal property
  status: 'dealstage',      // Standard deal property
  features: 'key_features',
  notes: 'notes',
  mlsNumber: 'mls_number',
};
```

The field mapping is stored per-tenant in `Tenant.hubspotListingProps`. During onboarding, the admin inspects the broker's HubSpot properties and configures the mapping.

### API Endpoints

**GET /api/hubspot/connect**
Initiates OAuth flow. Redirects to HubSpot.

**GET /api/hubspot/callback**
Handles OAuth callback. Stores tokens.

**GET /api/hubspot/listings**
Returns cached listings for the current tenant. If cache is stale (>15 min), triggers a sync first.

**GET /api/hubspot/contacts**
Returns cached contacts for the current tenant. Filterable by lead status.

**POST /api/hubspot/tasks**
Creates a task in HubSpot (for V2 follow-up workflow, but include the endpoint now).

---

## 7. Integration: Claude API (AI Generation)

### Streaming Proxy

All Claude API calls go through the server. The frontend never sees the API key.

**POST /api/claude/stream**
- Accepts: `{ systemPrompt, messages, maxTokens? }`
- Validates user session and tenant
- Calls Anthropic API with streaming enabled
- Proxies the SSE stream to the frontend
- Logs the action to ActivityLog

### Model

Use `claude-sonnet-4-6` for all workflows. Configurable per-tenant if needed later.

### System Prompt Construction

For the Marketing workflow, system prompts are hardcoded templates with listing data injected. No special context building needed.

For the Broker Assistant, the system prompt is built dynamically from cached HubSpot data:

```typescript
// src/lib/context-builder.ts

async function buildBrokerAssistantContext(tenantId: string): Promise<string> {
  const listings = await prisma.cachedListing.findMany({
    where: { tenantId },
    orderBy: { updatedAt: 'desc' },
  });

  const contacts = await prisma.cachedContact.findMany({
    where: { tenantId },
    orderBy: { lastContactDate: 'desc' },
    take: 50, // Limit to avoid token overflow
  });

  // Build context string with real data
  // Summarize rather than dump raw data to protect PII
  // and manage token count
  let context = `ACTIVE LISTINGS:\n`;
  for (const l of listings) {
    context += `- ${l.address} | ${l.priceDisplay} | ${l.beds}bd/${l.baths}ba/${l.sqft}sqft | ${l.daysOnMarket} DOM | Status: ${l.status}`;
    if (l.notes) context += ` | Notes: ${l.notes}`;
    context += `\n`;
  }

  context += `\nPIPELINE CONTACTS (${contacts.length} total):\n`;
  // Group by lead status
  const hot = contacts.filter(c => c.leadStatus === 'hot');
  const warm = contacts.filter(c => c.leadStatus === 'warm');
  // ... build summary

  return context;
}
```

**Token budget:** Keep the system prompt under 4,000 tokens. If a broker has many listings/contacts, summarize aggressively. The chat itself gets the remaining context window.

### Prompt Templates

Store prompt templates as constants in the codebase (not in the database for V1). Each workflow has its own system prompt template:

```
src/lib/prompts/
├── marketing-mls.ts          # MLS description generation
├── marketing-social.ts       # Instagram/Facebook caption
├── marketing-subjects.ts     # Email subject lines
├── broker-assistant.ts       # Chat system prompt
├── social-calendar.ts        # Weekly social plan (V1.5)
└── follow-up.ts              # Post-showing follow-up (V2)
```

---

## 8. Integration: Buffer (Social Scheduling)

### How It Works

Broker connects their Buffer account via OAuth. When they approve a social post, the caption + selected photo get pushed to their Buffer queue.

### Setup

1. Create a Buffer developer app at `buffer.com/developers`
2. Set redirect URI: `https://your-app.railway.app/api/buffer/callback`
3. Required permissions: publish access to connected profiles

### OAuth Flow

Same pattern as HubSpot. Store tokens in `BufferTokens`.

### API Endpoints

**GET /api/buffer/connect** — Initiates OAuth

**GET /api/buffer/callback** — Handles callback, stores tokens

**POST /api/buffer/queue**
- Accepts: `{ caption, imageUrl?, profileIds, scheduledAt? }`
- Downloads the image from Google Drive (via our proxy)
- Uploads to Buffer as a media attachment
- Creates a Buffer update (post) with the caption + image
- If `scheduledAt` is provided, schedules for that time; otherwise adds to Buffer's queue (Buffer auto-schedules)
- Returns the Buffer update ID for tracking

### Fallback for V1

If Buffer integration isn't ready in time for the pilot:
- Show "Copy to Clipboard" button alongside the approve button
- Show "Open Buffer" link that opens Buffer in a new tab
- The broker can paste the caption and manually upload the photo

This fallback should always be present even after Buffer is wired up, as a convenience option.

---

## 9. Background Data Sync

### HubSpot Sync Job

Runs every 15 minutes per active tenant.

```typescript
// Pseudocode for the sync loop
async function syncAllTenants() {
  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    include: { hubspotTokens: true },
  });

  for (const tenant of tenants) {
    if (!tenant.hubspotTokens) continue;
    try {
      await refreshTokenIfNeeded(tenant.hubspotTokens);
      await syncListings(tenant);
      await syncContacts(tenant);
    } catch (err) {
      console.error(`Sync failed for tenant ${tenant.id}:`, err);
      // Log to ActivityLog with error details
    }
  }
}

// Run every 15 minutes
setInterval(syncAllTenants, 15 * 60 * 1000);
// Also run on server start
syncAllTenants();
```

### Drive Folder Matching

After HubSpot sync, attempt to match listings to Drive folders:

1. Fetch subfolder names from the tenant's root Drive folder
2. For each listing without a `driveFolderId`, attempt fuzzy match
3. Matching logic: normalize both strings (lowercase, strip punctuation, remove common suffixes like "Dr", "St", "Ave"), then check if the street number + first word of street name match
4. If matched, update `CachedListing.driveFolderId`
5. If not matched, leave `driveFolderId` as null (UI shows "No photos linked" indicator)

This runs as part of the HubSpot sync, not as a separate job.

---

## 10. Workflow 1: Listing Marketing Pack

### User Flow

1. User navigates to Marketing tab
2. Listing selector shows all `CachedListings` for their tenant (filtered by `assignedListings` for AGENT role)
3. User selects a listing
4. Listing details auto-populate from cached HubSpot data (read-only display)
5. Drive photo picker loads photos from the matched Drive folder
6. User selects a hero photo (first photo auto-selected)
7. User clicks "Generate Marketing Pack"
8. App streams Claude response into output areas:
   - MLS Description (~250 words) — streams live into the MLS output block
   - Instagram Caption — populated after stream completes (parsed from delimited response)
   - Email Subject Lines (3 options) — populated after stream completes
   - Template card short copy — populated after stream completes, shown on the visual listing card
9. User can edit any generated text inline
10. User can click "Copy" on any output block
11. Buffer integration: user clicks "Push to Buffer" with selected photo + caption

### Listing Template Card

Port the visual listing card from the demo (white card with photo, address, specs, copy, price). This is purely a preview element showing how the content would look as a social graphic. In V1, it's not exported as an image — it's a visual reference.

### Claude Prompt for Marketing

Use the same structured output format from the demo with `===DELIMITER===` markers. Parse the response after streaming completes to split into sections.

Keep the prompt system from the demo — it works well. The key variables injected are:
- Address, beds, baths, sqft, price, features, DOM, city, status

---

## 11. Workflow 2: Broker Assistant (Chat)

### User Flow

1. User navigates to Assistant tab
2. Chat interface loads with a welcome message
3. System prompt is pre-built from cached HubSpot data (listings, contacts, tasks, calendar)
4. Suggestion buttons show contextual prompts (same concept as demo)
5. User types a question or clicks a suggestion
6. App streams Claude response into the chat
7. Multi-turn conversation maintained in state (and saved to `ChatSession` in DB)

### Context Refresh

- System prompt context is rebuilt from `CachedListing` and `CachedContact` tables
- Since HubSpot data syncs every 15 minutes, the context is always reasonably fresh
- Show "Last synced: X minutes ago" indicator in the chat header
- Add a manual "Refresh data" button that triggers an immediate HubSpot sync for the tenant

### Suggestion Buttons

Dynamic based on the broker's actual data:
- If there are hot leads, suggest "Who are my hottest leads right now?"
- If a listing has high DOM, suggest "What should I do about [address] — it's been on market [X] days"
- If there are pending tasks, suggest "What tasks need my attention today?"
- Always include a few generic suggestions as fallback

### Chat History

- Save each conversation to `ChatSession` with full message array
- Show a "Clear" button to start a new session
- V2: show past sessions in a sidebar

---

## 12. Admin Panel

### Tenant Management (/admin/tenants)

Only visible to ADMIN role users.

**Tenant list view:**
- Name, slug, status (active/inactive), connected integrations status, user count, last activity
- Click to edit

**Tenant detail/create view:**
- Brokerage name
- Logo URL
- Default tone
- HubSpot connection status + field mapping
- Drive root folder ID
- Buffer connection status
- Compliance standard (for V2)

### User Management (/admin/users)

- List all users across all tenants (or filter by tenant)
- Create new user: email, name, role, tenant assignment
- For AGENT role: assign specific listings
- Activate/deactivate users
- Users cannot be created through self-registration. Only admin creates users.

### Activity Log (/admin/activity)

Simple paginated log showing:
- Timestamp, tenant, user, action, details
- Filterable by tenant and action type
- Actions logged: login, marketing.generate, chat.message, buffer.queue, hubspot.sync, etc.

---

## 13. Design System

### Port from Demo

The existing demo has a strong visual identity. Port these design tokens to Tailwind:

```css
/* src/styles/tokens.css */
:root {
  --bg:       #0d0f12;
  --surface:  #141720;
  --card:     #1a1e28;
  --border:   #252a38;
  --border2:  #2e3548;
  --gold:     #c9a84c;
  --gold-dim: #7a6230;
  --teal:     #2dd4bf;
  --teal-dim: #0f766e;
  --coral:    #f87171;
  --coral-dim:#991b1b;
  --txt:      #e8eaf0;
  --txt2:     #8890a8;
  --txt3:     #545c78;
  --green:    #4ade80;
  --amber:    #fbbf24;
}
```

**Fonts:**
- Display: Cormorant Garamond (headings, prices)
- Body: Outfit (everything else)
- Mono: JetBrains Mono (code, traces, technical output)

**Key UI patterns to replicate:**
- Grid background overlay (subtle)
- Sticky topbar with glass effect
- Card component with subtle border and label
- Output blocks with channel badges (EMAIL, SMS, SOCIAL, etc.)
- Source item / listing card selection pattern
- Streaming cursor animation
- Trace log component
- Agent trace with timestamped lines

### Responsive

The demo already has thorough mobile breakpoints. Replicate the responsive behavior:
- 768px: stack two-column layouts, vertical workflow nav
- 480px: further size reductions, simplified topbar

### Topbar Layout

```
[Broker Logo] RE Agent OS          [Last synced: 3m ago] [3 Agents Active]
```

The topbar no longer shows an API key input (all keys are server-side).

---

## 14. Security Requirements

### Token Storage
- All OAuth tokens (HubSpot, Buffer) encrypted at rest in the database
- Use a symmetric encryption key stored in environment variables
- Never expose tokens to the frontend

### API Route Protection
- Every API route checks for valid NextAuth session
- Every API route verifies the user's tenant matches the requested data
- ADMIN role can specify a tenantId parameter; other roles cannot
- Rate limiting on Claude proxy route: 20 requests per minute per user

### Data Isolation
- All database queries include tenantId filter
- No endpoint ever returns data across tenants (except admin endpoints)
- Google Drive access is scoped to the tenant's configured folder

### CORS
- Not relevant since frontend and API are same origin (Next.js)

### Content Security
- Claude API key never sent to frontend
- No `anthropic-dangerous-direct-browser-access` header (all calls server-side)
- Generated content is text only, no executable code rendered

---

## 15. Deployment

### Railway Setup

**Service 1: Next.js App**
- Build command: `npm run build`
- Start command: `npm start`
- Port: 3000 (auto-detected)
- Health check: `/api/health`
- Environment variables: all from Section 2

**Service 2: PostgreSQL**
- Use Railway's managed Postgres
- DATABASE_URL auto-provisioned

### First Deploy Checklist

1. Create Railway project with Postgres addon
2. Set all environment variables
3. Run `npx prisma migrate deploy` (can be added to build command)
4. Deploy the app
5. Create the first ADMIN user directly in the database:
   ```sql
   INSERT INTO "User" (id, email, name, role, "isActive", "createdAt", "updatedAt")
   VALUES (gen_random_uuid(), 'your-email@gmail.com', 'Feroz', 'ADMIN', true, now(), now());
   ```
6. Log in with Google
7. Create the first tenant via admin panel
8. Create the broker's user account and assign to tenant
9. Connect HubSpot, configure Drive folder, connect Buffer

### Domain

Use Railway's built-in domain initially (`your-app.up.railway.app`). Add custom domain later.

---

## 16. V2 Roadmap (Do Not Implement — Architecture Only)

These features are planned for post-V1. The V1 architecture must not block them.

### Post-Showing Follow-Up (V2)
- Needs: Google Calendar integration (OAuth per tenant), email sending (Brevo/Resend), SMS (Twilio)
- The cached data model already supports showing data via HubSpot meetings/activities
- Add `CachedShowing` model when implementing

### Compliance Pipeline (V2)
- Needs: Email ingestion (forwarded inbox or IMAP), SOP document storage (Google Drive), task creation (HubSpot)
- The compliance SOP would be a file in the broker's Drive folder, referenced in tenant config
- Claude would receive the SOP as context alongside the document to review

### Social Calendar (V1.5 — near-term)
- The demo has this mostly designed. Wire it up to Buffer's scheduling API.
- Persist the generated calendar plan in the database
- Add a `SocialPlan` model with posts array and status tracking

### Email/SMS Sending (V2)
- Add Brevo or Resend integration for transactional email
- Add Twilio for SMS
- Both require per-tenant configuration and broker domain verification
- Always require explicit broker approval before sending

### MLS Integration (V2+)
- Write generated MLS copy back to HubSpot deal record
- Or integrate with MLS platforms directly (varies by market)

---

## 17. Implementation Order

Build in this sequence. Each step produces something testable.

### Phase 1: Foundation (Days 1-2)
1. Initialize Next.js project with TypeScript, Tailwind, Prisma
2. Set up Railway with Postgres
3. Configure NextAuth with Google OAuth
4. Build the database schema (run migrations)
5. Create the ADMIN user directly in DB
6. Build the topbar and dashboard layout (port design tokens)
7. Build the login page
8. Build basic admin panel: create tenant, create user

### Phase 2: HubSpot Integration (Days 2-3)
1. Set up HubSpot developer app
2. Build OAuth connect/callback flow
3. Build the listing and contact sync logic
4. Build the field mapping configuration (admin)
5. Test sync with the pilot broker's HubSpot
6. Build the listing selector component with real data

### Phase 3: Google Drive Integration (Days 3-4)
1. Set up Google Service Account
2. Build Drive API helpers (list folders, list files, proxy images)
3. Build folder auto-matching logic
4. Build the photo picker component
5. Test with the pilot broker's Drive folder

### Phase 4: Marketing Workflow (Days 4-5)
1. Build the Claude streaming proxy
2. Port the marketing prompt templates
3. Build the marketing page with real listing data + real photos
4. Build the listing template card preview
5. Build copy/edit functionality on output blocks
6. Test end-to-end: select listing, select photo, generate, review

### Phase 5: Broker Assistant (Days 5-6)
1. Build the context builder (dynamic system prompt from cached data)
2. Build the chat interface component
3. Build dynamic suggestion buttons
4. Build chat session persistence
5. Test with real broker data

### Phase 6: Buffer Integration (Days 6-7)
1. Set up Buffer developer app
2. Build OAuth connect/callback flow
3. Build the queue post endpoint (caption + image upload)
4. Add "Push to Buffer" button to marketing outputs
5. Build the fallback copy/link UI
6. Test end-to-end: generate, approve, push to Buffer

### Phase 7: Polish & Pilot (Days 7-8)
1. Responsive design pass
2. Error handling and loading states
3. Activity logging
4. Admin activity dashboard
5. Onboard the pilot broker
6. Monitor and fix issues

---

## 18. Testing the Pilot Broker

### Onboarding Checklist

- [ ] Admin creates tenant record with brokerage name and logo
- [ ] Admin creates broker user account (email, BROKER_OWNER role, assigned to tenant)
- [ ] Broker logs in with Google
- [ ] Broker connects HubSpot via settings page
- [ ] Admin configures HubSpot field mapping (after inspecting their property names)
- [ ] Broker shares Drive listing photos folder with service account email
- [ ] Admin sets Drive root folder ID in tenant config
- [ ] Broker connects Buffer account
- [ ] First HubSpot sync runs successfully
- [ ] Drive folder matching works for at least one listing
- [ ] Broker generates marketing copy for a real listing with real photos
- [ ] Broker uses the assistant to ask about their pipeline
- [ ] Broker pushes a post to Buffer successfully

### Known Risks

1. **HubSpot data model uncertainty** — We don't know how the broker structures their listings yet. The field mapping system handles this, but onboarding will require a discovery call to inspect their HubSpot setup.
2. **Drive folder naming** — Auto-matching depends on consistent folder naming. If the broker uses inconsistent names, manual mapping is the fallback.
3. **Buffer free tier limits** — 10 posts per channel. Fine for testing, but the broker will need to upgrade ($6/mo) for real use.
4. **Token refresh reliability** — HubSpot tokens expire every 30 minutes. The sync job handles refresh, but if the app is idle for hours, the first request might hit an expired token. Build in retry-on-401 logic.

---

## 19. Success Criteria for V1

The pilot is successful when:
1. Broker can log in and see their real listings from HubSpot
2. Broker can select a listing and see their real photos from Drive
3. Broker can generate marketing copy that sounds like it was written for their specific listing
4. Broker can ask the assistant questions about their actual pipeline and get accurate, specific answers
5. Broker can push an approved social post to Buffer with one click
6. The entire flow works without the broker needing to touch any code or configuration
7. Feroz (admin) can onboard the broker entirely through the admin panel + one Drive share step

---

*End of PRD*
