import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Edge-safe Auth.js config (no Prisma). Used by middleware only.
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
        token.role = (user as { role?: string }).role ?? "AGENT";
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
      return session;
    },
  },
} satisfies NextAuthConfig;
