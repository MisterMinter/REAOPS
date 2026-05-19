import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import {
  Prisma,
  SyncRunStatus,
  TouchpointDirection,
  type PrismaClient,
} from "@prisma/client";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { parseHubspotListingProps } from "@/lib/hubspot-mapping";
import { prisma as defaultPrisma } from "@/lib/prisma";

const HUBSPOT_AUTH_URL = "https://app.hubspot.com/oauth/authorize";
const HUBSPOT_TOKEN_URL = "https://api.hubspot.com/oauth/v3/token";
const HUBSPOT_API_BASE = "https://api.hubapi.com";
const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;

const DEFAULT_SCOPES = [
  "oauth",
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.deals.read",
  "crm.objects.deals.write",
];
const DEFAULT_OPTIONAL_SCOPES = ["crm.objects.notes.write"];

type HubSpotStatePayload = {
  tenantId: string;
  userId: string;
  exp: number;
  nonce: string;
};

type HubSpotTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  hub_id?: number | string;
  scopes?: string[];
};

type HubSpotObject = {
  id: string;
  properties?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
};

type HubSpotPage = {
  results?: HubSpotObject[];
  paging?: { next?: { after?: string } };
};

type SyncSummary = {
  contactsImported: number;
  listingsImported: number;
  objectType: string;
  removedInvalidProperties?: string[];
};

export class HubSpotError extends Error {
  status?: number;
  data?: unknown;

  constructor(message: string, status?: number, data?: unknown) {
    super(message);
    this.name = "HubSpotError";
    this.status = status;
    this.data = data;
  }
}

export function getHubSpotScopes(): string[] {
  const raw = process.env.HUBSPOT_SCOPES;
  if (!raw?.trim()) return DEFAULT_SCOPES;
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getHubSpotOptionalScopes(): string[] {
  const raw = process.env.HUBSPOT_OPTIONAL_SCOPES;
  if (!raw?.trim()) return DEFAULT_OPTIONAL_SCOPES;
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getHubSpotRedirectUri(origin?: string): string {
  if (process.env.HUBSPOT_REDIRECT_URI?.trim()) {
    return process.env.HUBSPOT_REDIRECT_URI.trim();
  }
  const base = origin || process.env.NEXTAUTH_URL;
  if (!base) throw new HubSpotError("Missing NEXTAUTH_URL or HUBSPOT_REDIRECT_URI.");
  return `${base.replace(/\/$/, "")}/api/hubspot/callback`;
}

export function createHubSpotState(input: { tenantId: string; userId: string }): string {
  const payload: HubSpotStatePayload = {
    tenantId: input.tenantId,
    userId: input.userId,
    exp: Date.now() + 10 * 60 * 1000,
    nonce: randomBytes(16).toString("base64url"),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${signStateBody(body)}`;
}

export function verifyHubSpotState(state: string): HubSpotStatePayload {
  const [body, sig] = state.split(".");
  if (!body || !sig) throw new HubSpotError("Invalid HubSpot OAuth state.");
  const expected = signStateBody(body);
  const sigBuf = Buffer.from(sig, "base64url");
  const expectedBuf = Buffer.from(expected, "base64url");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new HubSpotError("HubSpot OAuth state signature mismatch.");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as HubSpotStatePayload;
  if (!payload.tenantId || !payload.userId || payload.exp < Date.now()) {
    throw new HubSpotError("Expired HubSpot OAuth state.");
  }
  return payload;
}

export function buildHubSpotInstallUrl(input: {
  tenantId: string;
  userId: string;
  origin?: string;
}): string {
  const clientId = requireHubSpotEnv("HUBSPOT_CLIENT_ID");
  const redirectUri = getHubSpotRedirectUri(input.origin);
  const url = new URL(HUBSPOT_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", getHubSpotScopes().join(" "));
  const optionalScopes = getHubSpotOptionalScopes();
  if (optionalScopes.length > 0) {
    url.searchParams.set("optional_scope", optionalScopes.join(" "));
  }
  url.searchParams.set(
    "state",
    createHubSpotState({ tenantId: input.tenantId, userId: input.userId })
  );
  return url.toString();
}

export async function exchangeHubSpotCode(input: {
  code: string;
  redirectUri: string;
}): Promise<HubSpotTokenResponse> {
  return hubspotTokenRequest({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
  });
}

export async function storeHubSpotTokens(input: {
  prisma?: PrismaClient;
  tenantId: string;
  token: HubSpotTokenResponse;
}) {
  const prisma = input.prisma ?? defaultPrisma;
  const accessToken = input.token.access_token;
  const refreshToken = input.token.refresh_token;
  if (!accessToken || !refreshToken) {
    throw new HubSpotError("HubSpot did not return both access and refresh tokens.");
  }
  const expiresIn = typeof input.token.expires_in === "number" ? input.token.expires_in : 1800;
  const hubId = String(input.token.hub_id ?? "unknown");
  await prisma.hubSpotTokens.upsert({
    where: { tenantId: input.tenantId },
    create: {
      tenantId: input.tenantId,
      accessToken: encryptSecret(accessToken),
      refreshToken: encryptSecret(refreshToken),
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      hubId,
    },
    update: {
      accessToken: encryptSecret(accessToken),
      refreshToken: encryptSecret(refreshToken),
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      hubId,
    },
  });
}

export async function disconnectHubSpot(input: { prisma?: PrismaClient; tenantId: string }) {
  const prisma = input.prisma ?? defaultPrisma;
  await prisma.hubSpotTokens.deleteMany({ where: { tenantId: input.tenantId } });
}

export async function getTenantHubSpotAccessToken(input: {
  prisma?: PrismaClient;
  tenantId: string;
}): Promise<string | null> {
  const prisma = input.prisma ?? defaultPrisma;
  const tokens = await prisma.hubSpotTokens.findUnique({
    where: { tenantId: input.tenantId },
  });
  if (!tokens) return null;

  if (tokens.expiresAt.getTime() > Date.now() + TOKEN_REFRESH_WINDOW_MS) {
    return decryptStoredSecret(tokens.accessToken);
  }

  const refreshed = await hubspotTokenRequest({
    grant_type: "refresh_token",
    refresh_token: decryptStoredSecret(tokens.refreshToken),
  });
  if (!refreshed.access_token) throw new HubSpotError("HubSpot refresh did not return an access token.");

  const expiresIn = typeof refreshed.expires_in === "number" ? refreshed.expires_in : 1800;
  await prisma.hubSpotTokens.update({
    where: { tenantId: input.tenantId },
    data: {
      accessToken: encryptSecret(refreshed.access_token),
      refreshToken: refreshed.refresh_token
        ? encryptSecret(refreshed.refresh_token)
        : tokens.refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      hubId: String(refreshed.hub_id ?? tokens.hubId),
    },
  });
  return refreshed.access_token;
}

export async function syncHubSpotForTenant(input: {
  prisma?: PrismaClient;
  tenantId: string;
  actorId?: string | null;
}): Promise<SyncSummary> {
  const prisma = input.prisma ?? defaultPrisma;
  const run = await prisma.syncRun.create({
    data: {
      tenantId: input.tenantId,
      provider: "hubspot",
      direction: "inbound",
      status: SyncRunStatus.RUNNING,
    },
  });

  try {
    const token = await getTenantHubSpotAccessToken({ prisma, tenantId: input.tenantId });
    if (!token) throw new HubSpotError("HubSpot is not connected for this brokerage.");

    const tenant = await prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: {
        hubspotListingObject: true,
        hubspotListingProps: true,
      },
    });
    if (!tenant) throw new HubSpotError("Brokerage not found.");

    const invalidProperties = new Set<string>();
    const contactsImported = await importContacts(prisma, input.tenantId, token, invalidProperties);
    const objectType = tenant.hubspotListingObject || "deals";
    const listingsImported = await importListings(
      prisma,
      input.tenantId,
      token,
      objectType,
      tenant.hubspotListingProps,
      invalidProperties
    );
    const summary: SyncSummary = {
      contactsImported,
      listingsImported,
      objectType,
      removedInvalidProperties: Array.from(invalidProperties).sort(),
    };

    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: SyncRunStatus.SUCCEEDED,
        finishedAt: new Date(),
        summary: summary as Prisma.InputJsonValue,
      },
    });
    await prisma.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        userId: input.actorId ?? null,
        action: "hubspot.sync.inbound",
        subjectType: "SyncRun",
        subjectId: run.id,
        metadata: summary as Prisma.InputJsonValue,
      },
    });
    return summary;
  } catch (error) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: SyncRunStatus.FAILED,
        finishedAt: new Date(),
        error: error instanceof Error ? error.message : "HubSpot sync failed.",
      },
    });
    throw error;
  }
}

export async function syncPendingTouchpointsToHubSpot(input: {
  prisma?: PrismaClient;
  tenantId: string;
  actorId?: string | null;
  limit?: number;
}) {
  const prisma = input.prisma ?? defaultPrisma;
  const run = await prisma.syncRun.create({
    data: {
      tenantId: input.tenantId,
      provider: "hubspot",
      direction: "outbound",
      status: SyncRunStatus.RUNNING,
    },
  });

  try {
    const rows = await prisma.touchpoint.findMany({
      where: {
        tenantId: input.tenantId,
        direction: { in: [TouchpointDirection.OUTBOUND, TouchpointDirection.INTERNAL] },
        contact: { sourceSystem: "hubspot", externalId: { not: null } },
      },
      orderBy: { occurredAt: "desc" },
      take: input.limit ?? 50,
    });
    let synced = 0;
    let skipped = 0;
    for (const row of rows.reverse()) {
      const result = await syncTouchpointToHubSpot({
        prisma,
        tenantId: input.tenantId,
        touchpointId: row.id,
      });
      if (result.synced) synced += 1;
      else skipped += 1;
    }
    const summary = { synced, skipped };
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: SyncRunStatus.SUCCEEDED,
        finishedAt: new Date(),
        summary,
      },
    });
    await prisma.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        userId: input.actorId ?? null,
        action: "hubspot.sync.outbound",
        subjectType: "SyncRun",
        subjectId: run.id,
        metadata: summary,
      },
    });
    return summary;
  } catch (error) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: SyncRunStatus.FAILED,
        finishedAt: new Date(),
        error: error instanceof Error ? error.message : "HubSpot outbound sync failed.",
      },
    });
    throw error;
  }
}

export async function syncTouchpointToHubSpot(input: {
  prisma?: PrismaClient;
  tenantId: string;
  touchpointId: string;
}) {
  const prisma = input.prisma ?? defaultPrisma;
  const touchpoint = await prisma.touchpoint.findFirst({
    where: { id: input.touchpointId, tenantId: input.tenantId },
    include: { contact: true },
  });
  if (!touchpoint) throw new HubSpotError("Touchpoint not found.");
  const metadata = jsonObject(touchpoint.metadata);
  if (typeof metadata.hubspotNoteId === "string") return { synced: false, reason: "already_synced" };
  if (!touchpoint.contact?.externalId || touchpoint.contact.sourceSystem !== "hubspot") {
    return { synced: false, reason: "not_hubspot_contact" };
  }

  const token = await getTenantHubSpotAccessToken({ prisma, tenantId: input.tenantId });
  if (!token) return { synced: false, reason: "not_connected" };

  const label = touchpoint.channel ? `${touchpoint.channel} ${touchpoint.direction}` : touchpoint.direction;
  const body = [
    `<strong>REAOPS ${escapeHtml(label.toLowerCase())}</strong>`,
    touchpoint.subject ? `<p><strong>${escapeHtml(touchpoint.subject)}</strong></p>` : null,
    `<p>${escapeHtml(touchpoint.body).replace(/\n/g, "<br>")}</p>`,
  ]
    .filter(Boolean)
    .join("");

  const note = await hubspotRequest<{ id: string }>(token, "/crm/v3/objects/notes", {
    method: "POST",
    body: {
      properties: {
        hs_timestamp: touchpoint.occurredAt.toISOString(),
        hs_note_body: body,
      },
      associations: [
        {
          to: { id: touchpoint.contact.externalId },
          types: [
            {
              associationCategory: "HUBSPOT_DEFINED",
              associationTypeId: 202,
            },
          ],
        },
      ],
    },
  });

  await prisma.touchpoint.update({
    where: { id: touchpoint.id },
    data: {
      metadata: {
        ...metadata,
        hubspotNoteId: note.id,
        hubspotSyncedAt: new Date().toISOString(),
      },
    },
  });
  return { synced: true, id: note.id };
}

async function importContacts(
  prisma: PrismaClient,
  tenantId: string,
  token: string,
  invalidProperties: Set<string>
): Promise<number> {
  const records = await fetchPagedObjects(
    token,
    "contacts",
    ["firstname", "lastname", "email", "phone", "hs_lead_status", "notes_last_contacted"],
    invalidProperties
  );

  for (const record of records) {
    const props = record.properties ?? {};
    const lastContactDate = dateProp(props.notes_last_contacted);
    const data = {
      tenantId,
      hubspotId: record.id,
      firstName: stringProp(props.firstname),
      lastName: stringProp(props.lastname),
      email: stringProp(props.email),
      phone: stringProp(props.phone),
      leadStatus: stringProp(props.hs_lead_status),
      lastContactDate,
      associatedDeals: Prisma.JsonNull,
      notes: null,
      rawData: record as unknown as Prisma.InputJsonValue,
      lastSyncedAt: new Date(),
    };
    await prisma.cachedContact.upsert({
      where: { tenantId_hubspotId: { tenantId, hubspotId: record.id } },
      create: data,
      update: data,
    });

    const existing = await prisma.contact.findFirst({
      where: { tenantId, sourceSystem: "hubspot", externalId: record.id },
      select: { id: true },
    });
    const contactData = {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      status: data.leadStatus || "HubSpot",
      lastContactAt: lastContactDate,
      rawData: record as unknown as Prisma.InputJsonValue,
    };
    if (existing) {
      await prisma.contact.update({ where: { id: existing.id }, data: contactData });
    } else {
      await prisma.contact.create({
        data: {
          tenantId,
          sourceSystem: "hubspot",
          externalId: record.id,
          ...contactData,
        },
      });
    }
  }

  return records.length;
}

async function importListings(
  prisma: PrismaClient,
  tenantId: string,
  token: string,
  objectType: string,
  mappingRaw: unknown,
  invalidProperties: Set<string>
): Promise<number> {
  const mapping = parseHubspotListingProps(mappingRaw);
  const properties = [
    "dealname",
    "amount",
    "dealstage",
    "pipeline",
    "createdate",
    "hs_lastmodifieddate",
    ...Object.values(mapping),
  ];
  const records = await fetchPagedObjects(token, objectType, properties, invalidProperties);

  for (const record of records) {
    const props = record.properties ?? {};
    const externalId = `${objectType}:${record.id}`;
    const address = stringProp(props[mapping.address]) || stringProp(props.dealname) || `HubSpot ${objectType} ${record.id}`;
    const price = intProp(props[mapping.price]) ?? intProp(props.amount);
    const shortAddress = address.split(",")[0]?.trim() || address;
    const data = {
      address,
      shortAddress,
      city: stringProp(props[mapping.city]) ?? "",
      state: stringProp(props[mapping.state]) ?? "",
      zip: stringProp(props[mapping.zip]),
      beds: intProp(props[mapping.beds]),
      baths: floatProp(props[mapping.baths]),
      sqft: intProp(props[mapping.sqft]),
      price,
      priceDisplay: price ? `$${price.toLocaleString("en-US")}` : "",
      status: stringProp(props[mapping.status]) || stringProp(props.dealstage) || "Active",
      daysOnMarket: null,
      features: stringProp(props[mapping.features]),
      notes: stringProp(props[mapping.notes]),
      mlsNumber: stringProp(props[mapping.mlsNumber]),
      driveFolderId: null,
      rawData: record as unknown as Prisma.InputJsonValue,
      lastSyncedAt: new Date(),
    };
    await prisma.cachedListing.upsert({
      where: { tenantId_hubspotId: { tenantId, hubspotId: externalId } },
      create: {
        tenantId,
        hubspotId: externalId,
        ...data,
      },
      update: data,
    });
    await prisma.listing.upsert({
      where: {
        tenantId_sourceSystem_externalId: {
          tenantId,
          sourceSystem: "hubspot",
          externalId,
        },
      },
      create: {
        tenantId,
        sourceSystem: "hubspot",
        externalId,
        address: data.address,
        shortAddress: data.shortAddress,
        city: data.city,
        state: data.state,
        zip: data.zip,
        beds: data.beds,
        baths: data.baths,
        sqft: data.sqft,
        price: data.price,
        priceDisplay: data.priceDisplay,
        status: data.status,
        daysOnMarket: data.daysOnMarket,
        features: data.features,
        notes: data.notes,
        mlsNumber: data.mlsNumber,
        driveFolderId: data.driveFolderId,
        rawData: data.rawData,
      },
      update: {
        address: data.address,
        shortAddress: data.shortAddress,
        city: data.city,
        state: data.state,
        zip: data.zip,
        beds: data.beds,
        baths: data.baths,
        sqft: data.sqft,
        price: data.price,
        priceDisplay: data.priceDisplay,
        status: data.status,
        daysOnMarket: data.daysOnMarket,
        features: data.features,
        notes: data.notes,
        mlsNumber: data.mlsNumber,
        driveFolderId: data.driveFolderId,
        rawData: data.rawData,
      },
    });
  }

  return records.length;
}

async function fetchPagedObjects(
  token: string,
  objectType: string,
  properties: string[],
  invalidProperties: Set<string>
): Promise<HubSpotObject[]> {
  const out: HubSpotObject[] = [];
  let after: string | undefined;
  let page = 0;
  let activeProperties = unique(properties);
  const maxPages = Number(process.env.HUBSPOT_SYNC_MAX_PAGES ?? 10);

  while (page < maxPages) {
    const params = new URLSearchParams({ limit: "100", archived: "false" });
    if (activeProperties.length > 0) params.set("properties", activeProperties.join(","));
    if (after) params.set("after", after);

    try {
      const data = await hubspotRequest<HubSpotPage>(
        token,
        `/crm/v3/objects/${encodeURIComponent(objectType)}?${params.toString()}`
      );
      out.push(...(data.results ?? []));
      after = data.paging?.next?.after;
      page += 1;
      if (!after) break;
    } catch (error) {
      const invalid = invalidPropertyNames(error);
      if (invalid.length === 0) throw error;
      for (const p of invalid) invalidProperties.add(p);
      activeProperties = activeProperties.filter((p) => !invalid.includes(p));
      if (activeProperties.length === 0) throw error;
    }
  }
  return out;
}

async function hubspotTokenRequest(params: Record<string, string>): Promise<HubSpotTokenResponse> {
  const clientId = requireHubSpotEnv("HUBSPOT_CLIENT_ID");
  const clientSecret = requireHubSpotEnv("HUBSPOT_CLIENT_SECRET");
  const res = await fetch(HUBSPOT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      ...params,
    }),
  });
  const data = await readJson(res);
  if (!res.ok) throw hubspotResponseError(res, data);
  return data as HubSpotTokenResponse;
}

async function hubspotRequest<T>(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(`${HUBSPOT_API_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await readJson(res);
  if (!res.ok) throw hubspotResponseError(res, data);
  return data as T;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function hubspotResponseError(res: Response, data: unknown): HubSpotError {
  const msg = typeof data === "object" && data && "message" in data
    ? String((data as { message?: unknown }).message)
    : `HubSpot request failed with ${res.status}`;
  return new HubSpotError(msg, res.status, data);
}

function requireHubSpotEnv(name: "HUBSPOT_CLIENT_ID" | "HUBSPOT_CLIENT_SECRET"): string {
  const value = process.env[name];
  if (!value?.trim()) throw new HubSpotError(`${name} is not configured.`);
  return value.trim();
}

function signStateBody(body: string): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new HubSpotError("AUTH_SECRET must be set for HubSpot OAuth state.");
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function decryptStoredSecret(value: string): string {
  try {
    return decryptSecret(value);
  } catch {
    return value;
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function invalidPropertyNames(error: unknown): string[] {
  if (!(error instanceof HubSpotError)) return [];
  const data = error.data as
    | {
        message?: string;
        context?: { propertyName?: string[] };
        errors?: Array<{ context?: { propertyName?: string[] } }>;
      }
    | undefined;
  const fromContext = data?.context?.propertyName ?? [];
  const fromErrors = data?.errors?.flatMap((e) => e.context?.propertyName ?? []) ?? [];
  const fromMessage = Array.from(data?.message?.matchAll(/Property "([^"]+)"/g) ?? []).map((m) => m[1]);
  return unique([...fromContext, ...fromErrors, ...fromMessage]);
}

function stringProp(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

function intProp(value: unknown): number | null {
  const raw = stringProp(value);
  if (!raw) return null;
  const n = Number(raw.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function floatProp(value: unknown): number | null {
  const raw = stringProp(value);
  if (!raw) return null;
  const n = Number(raw.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function dateProp(value: unknown): Date | null {
  const raw = stringProp(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
