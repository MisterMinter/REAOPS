import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import type { UserRole } from "@prisma/client";

export function userRoleFromAdapterUser(user: unknown): UserRole {
  const r = (user as { role?: string } | null | undefined)?.role;
  if (r === "ADMIN" || r === "BROKER_OWNER" || r === "AGENT") return r;
  return "AGENT";
}

/**
 * Edge-safe Auth.js config (no Prisma client). Used by middleware only.
 * Full Node config with adapter + DB events lives in `auth.ts`.
 */
export const authConfig = {
  trustHost: true,
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            allowDangerousEmailAccountLinking: true,
            authorization: {
              params: {
                scope: [
                  "openid",
                  "email",
                  "profile",
                  "https://www.googleapis.com/auth/drive",
                  "https://www.googleapis.com/auth/calendar",
                  "https://www.googleapis.com/auth/gmail.compose",
                ].join(" "),
                access_type: "offline",
                prompt: "consent",
              },
            },
          }),
        ]
      : []),
  ],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  callbacks: {
    // signIn with DB whitelist lives in `auth.ts` only (Prisma; not safe on Edge middleware).
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = userRoleFromAdapterUser(user);
        token.tenantId = ((user as { tenantId?: string | null }).tenantId ?? null) as string | null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? (token.sub as string);
        session.user.role = (token.role as typeof session.user.role) ?? "AGENT";
        session.user.tenantId = (token.tenantId as string | null) ?? null;
      }
      session.accessToken =
        typeof token.googleAccessToken === "string" ? token.googleAccessToken : undefined;
      session.error =
        typeof token.googleAccessError === "string" ? token.googleAccessError : undefined;
      return session;
    },
  },
} satisfies NextAuthConfig;
