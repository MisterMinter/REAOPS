import type { JWT } from "next-auth/jwt";

/**
 * Exchange a Google OAuth refresh token for a new access token.
 */
export async function refreshGoogleAccessToken(token: JWT): Promise<JWT> {
  const refresh = token.googleRefreshToken;
  if (!refresh || typeof refresh !== "string") {
    return { ...token, googleAccessError: "MissingRefreshToken" };
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ...token, googleAccessError: "MissingGoogleOAuthConfig" };
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refresh,
    }),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    console.error("Google token refresh failed", data);
    return {
      ...token,
      googleAccessError: "RefreshAccessTokenError",
      googleAccessToken: undefined,
    };
  }

  const access = data.access_token as string | undefined;
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return {
    ...token,
    googleAccessToken: access,
    googleAccessTokenExpires: Date.now() + expiresIn * 1000,
    googleRefreshToken:
      typeof data.refresh_token === "string" ? data.refresh_token : token.googleRefreshToken,
    googleAccessError: undefined,
  };
}
