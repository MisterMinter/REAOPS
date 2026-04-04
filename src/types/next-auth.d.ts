import type { DefaultSession } from "next-auth";
import type { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: UserRole;
      tenantId: string | null;
    };
    /** Google OAuth access token for Drive API (server / API routes). */
    accessToken?: string;
    /** Set when Google token refresh fails — user should sign in again. */
    error?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: UserRole;
    tenantId?: string | null;
    googleAccessToken?: string;
    googleRefreshToken?: string;
    googleAccessTokenExpires?: number;
    googleAccessError?: string;
  }
}
