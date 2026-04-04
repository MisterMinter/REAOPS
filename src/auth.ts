import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { authConfig } from "@/auth.config";
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
    async jwt({ token, user, ...rest }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role?: string }).role ?? "AGENT";
        token.tenantId = (user as { tenantId?: string | null }).tenantId ?? null;
        const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;
          token.tenantId = dbUser.tenantId;
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
