import type { UserRole } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

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

export async function getOnboardingSnapshot(
  prisma: PrismaClient,
  input: { id: string; role: UserRole; tenantId: string | null }
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
        driveConfig: { select: { id: true } },
        _count: { select: { cachedListings: true, cachedContacts: true } },
      },
    });
    if (t) {
      tenantName = t.brokerageName ?? t.name;
      hasLogo = Boolean(t.logoUrl);
      hasDriveFolder = Boolean(t.driveConfig);
      hubspotConnected = Boolean(t.hubspotTokens);
      bufferConnected = Boolean(t.bufferTokens);
      listingCount = t._count.cachedListings;
      contactCount = t._count.cachedContacts;
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
