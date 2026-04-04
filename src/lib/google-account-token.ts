import { prisma } from "@/lib/prisma";

/**
 * Valid Google OAuth access token for Drive API, loaded from the Account row (not the JWT).
 * JWT session cookies often omit or truncate `accessToken` in production; the database copy is reliable.
 */
export async function getGoogleAccessTokenForUser(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });
  if (!account) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const exp = account.expires_at ?? 0;
  if (account.access_token && exp > nowSec + 60) {
    return account.access_token;
  }

  if (!account.refresh_token) {
    return account.access_token ?? null;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return account.access_token ?? null;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: account.refresh_token,
    }),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    console.error("Google Account token refresh failed", data);
    return account.access_token ?? null;
  }

  const access = data.access_token as string | undefined;
  if (!access) return account.access_token ?? null;

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  const newRefresh =
    typeof data.refresh_token === "string" ? data.refresh_token : account.refresh_token;

  await prisma.account.update({
    where: { id: account.id },
    data: {
      access_token: access,
      expires_at: nowSec + expiresIn,
      refresh_token: newRefresh,
    },
  });

  return access;
}
