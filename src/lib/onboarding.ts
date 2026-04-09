import type { PrismaClient, UserRole } from "@prisma/client";
import { listDriveListingFolders } from "@/lib/drive";
import { getGoogleAccessTokenForUser } from "@/lib/google-account-token";
import { mergedListingCount } from "@/lib/marketing-listings";
import { prisma as globalPrisma } from "@/lib/prisma";

export type OnboardingSnapshot = {
  role: UserRole;
  roleLabel: string;
  tenantId: string | null;
  tenantName: string | null;
  /** ADMIN with no tenant — platform onboarding only */
  platformOnly: boolean;
  tenantCount: number;
  userCount: number;
  hasDriveFolder: boolean;
  hubspotConnected: boolean;
  bufferConnected: boolean;
  listingCount: number;
  contactCount: number;
  hasLogo: boolean;
};

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Platform admin",
  BROKER_OWNER: "Broker owner",
  AGENT: "Agent",
};

export type OnboardingOptions = {
  /** @deprecated Prefer googleTokenUserId — JWT may omit accessToken in production. */
  googleAccessToken?: string;
  /** Load Google token from Account + refresh (reliable for Drive API). */
  googleTokenUserId?: string;
};

export async function getOnboardingSnapshot(
  prisma: PrismaClient,
  input: { id: string; role: UserRole; tenantId: string | null },
  options?: OnboardingOptions
): Promise<OnboardingSnapshot> {
  const [tenantCount, userCount] = await Promise.all([
    prisma.tenant.count(),
    prisma.user.count(),
  ]);

  let tenantName: string | null = null;
  let hasDriveFolder = false;
  let hubspotConnected = false;
  let bufferConnected = false;
  let listingCount = 0;
  let contactCount = 0;
  let hasLogo = false;

  if (input.tenantId) {
    const t = await prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: {
        name: true,
        brokerageName: true,
        logoUrl: true,
        hubspotTokens: { select: { id: true } },
        bufferTokens: { select: { id: true } },
        driveConfig: { select: { id: true, rootFolderId: true } },
        cachedListings: { select: { driveFolderId: true } },
        _count: { select: { cachedContacts: true } },
      },
    });
    if (t) {
      tenantName = t.brokerageName ?? t.name;
      hasLogo = Boolean(t.logoUrl);
      hasDriveFolder = Boolean(t.driveConfig);
      hubspotConnected = Boolean(t.hubspotTokens);
      bufferConnected = Boolean(t.bufferTokens);
      contactCount = t._count.cachedContacts;

      let driveFolders: { id: string }[] | null = null;
      let driveToken: string | null = null;
      if (options?.googleTokenUserId) {
        driveToken = await getGoogleAccessTokenForUser(options.googleTokenUserId);
      }
      if (!driveToken && options?.googleAccessToken) {
        driveToken = options.googleAccessToken;
      }
      if (!driveToken && input.tenantId) {
        driveToken = await getAnyTenantDriveToken(input.tenantId, options?.googleTokenUserId);
      }
      if (t.driveConfig && driveToken) {
        try {
          driveFolders = await listDriveListingFolders(driveToken, t.driveConfig.rootFolderId);
        } catch {
          driveFolders = null;
        }
      }
      listingCount = mergedListingCount(t.cachedListings, driveFolders);
    }
  }

  return {
    role: input.role,
    roleLabel: ROLE_LABELS[input.role],
    tenantId: input.tenantId,
    tenantName,
    platformOnly: input.role === "ADMIN" && !input.tenantId,
    tenantCount,
    userCount,
    hasDriveFolder,
    hubspotConnected,
    bufferConnected,
    listingCount,
    contactCount,
    hasLogo,
  };
}

async function getAnyTenantDriveToken(
  tenantId: string,
  skipUserId?: string
): Promise<string | null> {
  const accounts = await globalPrisma.account.findMany({
    where: {
      provider: "google",
      user: { tenantId },
      refresh_token: { not: null },
      ...(skipUserId ? { NOT: { userId: skipUserId } } : {}),
    },
    select: { userId: true },
    take: 5,
  });

  for (const acct of accounts) {
    const token = await getGoogleAccessTokenForUser(acct.userId);
    if (token) return token;
  }
  return null;
}
