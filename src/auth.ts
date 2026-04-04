import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { authConfig, userRoleFromAdapterUser } from "@/auth.config";
import { refreshGoogleAccessToken } from "@/lib/google-oauth";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, profile }) {
      const emailRaw = user.email ?? (profile as { email?: string } | undefined)?.email;
      if (!emailRaw || typeof emailRaw !== "string") return false;
      const email = emailRaw.trim().toLowerCase();
      const dbUser = await prisma.user.findUnique({ where: { email } });
      return Boolean(dbUser?.isActive);
    },
    async jwt({ token, user, account }) {
      const acc = account as
        | {
            provider?: string;
            access_token?: string | null;
            refresh_token?: string | null;
            expires_at?: number | null;
          }
        | undefined
        | null;

      if (acc?.provider === "google") {
        token.googleAccessToken = acc.access_token ?? undefined;
        token.googleRefreshToken = acc.refresh_token ?? undefined;
        const expSec = acc.expires_at;
        token.googleAccessTokenExpires =
          typeof expSec === "number" ? expSec * 1000 : Date.now() + 3600 * 1000;
        token.googleAccessError = undefined;
      }

      if (user?.id) {
        token.id = user.id as string;
        token.role = userRoleFromAdapterUser(user);
        token.tenantId = (user as { tenantId?: string | null }).tenantId ?? null;
        const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;
          token.tenantId = dbUser.tenantId;
        }
      }

      if (token.googleRefreshToken) {
        const exp =
          typeof token.googleAccessTokenExpires === "number"
            ? token.googleAccessTokenExpires
            : 0;
        const hasAccess =
          typeof token.googleAccessToken === "string" && token.googleAccessToken.length > 0;
        const expiredOrSoon = !hasAccess || exp === 0 || Date.now() >= exp - 60_000;
        if (expiredOrSoon) {
          return refreshGoogleAccessToken(token);
        }
      }

      return token;
    },
    async session(params) {
      const base = await authConfig.callbacks.session!(params);
      const id = base.user?.id;
      if (base.user && id) {
        const dbUser = await prisma.user.findUnique({ where: { id } });
        if (dbUser) {
          base.user.id = dbUser.id;
          base.user.role = dbUser.role;
          base.user.tenantId = dbUser.tenantId;
        }
      }
      return base;
    },
  },
  events: {
    async signIn({ user }) {
      if (!user.id) return;
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
    },
  },
});
