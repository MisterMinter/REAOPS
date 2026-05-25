import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { type Prisma, type PrismaClient } from "@prisma/client";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma as defaultPrisma } from "@/lib/prisma";

const BUFFER_AUTH_URL = "https://bufferapp.com/oauth2/authorize";
const BUFFER_TOKEN_URL = "https://api.bufferapp.com/1/oauth2/token.json";
const BUFFER_API = "https://api.bufferapp.com/1";

type BufferStatePayload = {
  tenantId: string;
  userId: string;
  exp: number;
  nonce: string;
};

export type BufferTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

export type BufferProfile = {
  id: string;
  service: string;
  username: string;
  default: boolean;
};

export class BufferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BufferError";
  }
}

export function getBufferRedirectUri(origin?: string): string {
  if (process.env.BUFFER_REDIRECT_URI?.trim()) return process.env.BUFFER_REDIRECT_URI.trim();
  const base = origin || process.env.NEXTAUTH_URL;
  if (!base) throw new BufferError("Missing NEXTAUTH_URL or BUFFER_REDIRECT_URI.");
  return `${base.replace(/\/$/, "")}/api/buffer/callback`;
}

export function buildBufferInstallUrl(input: {
  tenantId: string;
  userId: string;
  origin?: string;
}) {
  const clientId = requireBufferEnv("BUFFER_CLIENT_ID");
  const url = new URL(BUFFER_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", getBufferRedirectUri(input.origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", createBufferState(input));
  return url.toString();
}

export function createBufferState(input: { tenantId: string; userId: string }): string {
  const payload: BufferStatePayload = {
    tenantId: input.tenantId,
    userId: input.userId,
    exp: Date.now() + 10 * 60 * 1000,
    nonce: randomBytes(16).toString("base64url"),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${signStateBody(body)}`;
}

export function verifyBufferState(state: string): BufferStatePayload {
  const [body, sig] = state.split(".");
  if (!body || !sig) throw new BufferError("Invalid Buffer OAuth state.");
  const expected = signStateBody(body);
  const sigBuf = Buffer.from(sig, "base64url");
  const expectedBuf = Buffer.from(expected, "base64url");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new BufferError("Buffer OAuth state signature mismatch.");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as BufferStatePayload;
  if (!payload.tenantId || !payload.userId || payload.exp < Date.now()) {
    throw new BufferError("Expired Buffer OAuth state.");
  }
  return payload;
}

export async function exchangeBufferCode(input: {
  code: string;
  redirectUri: string;
}): Promise<BufferTokenResponse> {
  const res = await fetch(BUFFER_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireBufferEnv("BUFFER_CLIENT_ID"),
      client_secret: requireBufferEnv("BUFFER_CLIENT_SECRET"),
      redirect_uri: input.redirectUri,
      code: input.code,
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as BufferTokenResponse & { error?: string; message?: string };
  if (!res.ok) {
    throw new BufferError(data.error ?? data.message ?? `Buffer token exchange failed (${res.status}).`);
  }
  return data;
}

export async function storeBufferTokens(input: {
  prisma?: PrismaClient;
  tenantId: string;
  token: BufferTokenResponse;
}) {
  const prisma = input.prisma ?? defaultPrisma;
  const accessToken = input.token.access_token;
  if (!accessToken) throw new BufferError("Buffer did not return an access token.");
  const expiresAt =
    typeof input.token.expires_in === "number"
      ? new Date(Date.now() + input.token.expires_in * 1000)
      : null;
  await prisma.bufferTokens.upsert({
    where: { tenantId: input.tenantId },
    create: {
      tenantId: input.tenantId,
      accessToken: encryptSecret(accessToken),
      refreshToken: input.token.refresh_token ? encryptSecret(input.token.refresh_token) : null,
      expiresAt,
    },
    update: {
      accessToken: encryptSecret(accessToken),
      refreshToken: input.token.refresh_token ? encryptSecret(input.token.refresh_token) : undefined,
      expiresAt,
    },
  });
}

export async function disconnectBuffer(input: { prisma?: PrismaClient; tenantId: string }) {
  const prisma = input.prisma ?? defaultPrisma;
  await prisma.bufferTokens.deleteMany({ where: { tenantId: input.tenantId } });
}

export async function getTenantBufferAccessToken(input: {
  prisma?: PrismaClient;
  tenantId: string;
}): Promise<string | null> {
  const prisma = input.prisma ?? defaultPrisma;
  const tokens = await prisma.bufferTokens.findUnique({ where: { tenantId: input.tenantId } });
  if (tokens?.accessToken) return decryptStoredSecret(tokens.accessToken);
  return process.env.BUFFER_ACCESS_TOKEN?.trim() || null;
}

export async function listBufferProfiles(input: {
  prisma?: PrismaClient;
  tenantId: string;
}): Promise<BufferProfile[]> {
  const token = await getTenantBufferAccessToken(input);
  if (!token) throw new BufferError("Buffer is not connected.");
  const raw = (await bufferGet("/profiles.json", token)) as Array<{
    id: string;
    service: string;
    formatted_username?: string;
    default?: boolean;
  }>;
  return raw.map((profile) => ({
    id: profile.id,
    service: profile.service,
    username: profile.formatted_username ?? "unknown",
    default: profile.default ?? false,
  }));
}

export async function selectBufferProfiles(input: {
  prisma?: PrismaClient;
  tenantId: string;
  profileIds: string[];
}) {
  const prisma = input.prisma ?? defaultPrisma;
  await prisma.bufferTokens.update({
    where: { tenantId: input.tenantId },
    data: { profileIds: input.profileIds as Prisma.InputJsonValue },
  });
}

export async function createBufferDraft(input: {
  prisma?: PrismaClient;
  tenantId: string;
  text: string;
  profileIds?: string[];
  scheduledAt?: string | null;
  mediaUrl?: string | null;
}) {
  const prisma = input.prisma ?? defaultPrisma;
  const token = await getTenantBufferAccessToken({ prisma, tenantId: input.tenantId });
  if (!token) throw new BufferError("Buffer is not connected.");
  const configured = await prisma.bufferTokens.findUnique({
    where: { tenantId: input.tenantId },
    select: { profileIds: true },
  });
  let ids = input.profileIds?.filter(Boolean) ?? [];
  if (ids.length === 0) ids = stringArrayFrom(configured?.profileIds);
  if (ids.length === 0) ids = (await listBufferProfiles({ prisma, tenantId: input.tenantId })).map((profile) => profile.id);
  if (ids.length === 0) throw new BufferError("No Buffer profiles are selected.");

  const params: Record<string, string | string[]> = {
    text: input.text,
    profile_ids: ids,
    draft: "true",
  };
  if (input.scheduledAt) params.scheduled_at = input.scheduledAt;
  if (input.mediaUrl) params["media[photo]"] = input.mediaUrl;
  return bufferPost("/updates/create.json", token, params);
}

export async function checkBufferHealth(input: {
  prisma?: PrismaClient;
  tenantId: string;
}) {
  try {
    const profiles = await listBufferProfiles(input);
    return { ok: true, profiles };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Buffer health check failed.", profiles: [] };
  }
}

async function bufferGet(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${BUFFER_API}${path}?access_token=${encodeURIComponent(token)}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new BufferError(`Buffer API ${path} => ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function bufferPost(path: string, token: string, params: Record<string, string | string[]>): Promise<unknown> {
  const body = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (Array.isArray(val)) {
      for (const v of val) body.append(`${key}[]`, v);
    } else {
      body.append(key, val);
    }
  }
  body.append("access_token", token);

  const res = await fetch(`${BUFFER_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new BufferError(`Buffer API POST ${path} => ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

function requireBufferEnv(name: "BUFFER_CLIENT_ID" | "BUFFER_CLIENT_SECRET") {
  const value = process.env[name]?.trim();
  if (!value) throw new BufferError(`${name} is not configured.`);
  return value;
}

function signStateBody(body: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new BufferError("AUTH_SECRET is required for Buffer OAuth state.");
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function decryptStoredSecret(value: string) {
  try {
    return decryptSecret(value);
  } catch {
    return value;
  }
}

function stringArrayFrom(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}
