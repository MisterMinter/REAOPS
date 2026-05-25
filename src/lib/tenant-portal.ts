import type { PrismaClient, UserRole } from "@prisma/client";
import { getTenantBrain } from "@/lib/tenant-brain";
import { parseBrandKit } from "@/lib/marketing/brand-kit";

export type PortalHealthStatus = "ready" | "warning" | "blocked";

export type PortalHealthItem = {
  key: string;
  label: string;
  status: PortalHealthStatus;
  detail: string;
  requiredForGoLive: boolean;
  href?: string;
};

export async function getTenantPortalSnapshot(
  prisma: PrismaClient,
  user: { id: string; role: UserRole; tenantId: string | null }
) {
  if (!user.tenantId) {
    const [tenantCount, userCount] = await Promise.all([
      prisma.tenant.count(),
      prisma.user.count(),
    ]);
    return {
      platformOnly: true as const,
      tenantCount,
      userCount,
    };
  }

  const [
    tenant,
    members,
    googleAccountCount,
    pendingApprovals,
    openCompliance,
    unreadNotifications,
    recentRuns,
    recentJobs,
    recentAudit,
  ] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: user.tenantId },
      include: {
        driveConfig: true,
        hubspotTokens: { select: { hubId: true, updatedAt: true } },
        bufferTokens: { select: { updatedAt: true, profileIds: true } },
        zillowProfileSources: { select: { id: true } },
        channelAccounts: { orderBy: { updatedAt: "desc" } },
        sendingIdentities: { orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] },
        agentLoops: { orderBy: { kind: "asc" } },
      },
    }),
    prisma.user.findMany({
      where: { tenantId: user.tenantId },
      select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true },
      orderBy: [{ isActive: "desc" }, { email: "asc" }],
    }),
    prisma.account.count({
      where: {
        provider: "google",
        refresh_token: { not: null },
        user: { tenantId: user.tenantId, isActive: true },
      },
    }),
    prisma.approval.count({ where: { tenantId: user.tenantId, status: "PENDING" } }),
    prisma.complianceReview.count({
      where: { tenantId: user.tenantId, status: { in: ["OPEN", "IN_REVIEW", "FLAGGED", "NEEDS_HUMAN"] } },
    }),
    prisma.agentNotification.count({
      where: { tenantId: user.tenantId, userId: user.id, readAt: null },
    }),
    prisma.agentRun.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { startedAt: "desc" },
      take: 5,
      select: { id: true, kind: true, status: true, trigger: true, summary: true, startedAt: true, finishedAt: true },
    }),
    prisma.jobRun.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { startedAt: "desc" },
      take: 5,
      select: { id: true, kind: true, status: true, trigger: true, summary: true, error: true, startedAt: true },
    }),
    prisma.auditEvent.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, action: true, subjectType: true, subjectId: true, createdAt: true },
    }),
  ]);

  if (!tenant) {
    return {
      platformOnly: true as const,
      tenantCount: await prisma.tenant.count(),
      userCount: await prisma.user.count(),
    };
  }

  const brandKit = parseBrandKit(tenant.brandKit);
  const blueBubbles = tenant.channelAccounts.find((account) => account.kind === "BLUEBUBBLES");
  const telegramLinked = members.some((member) => member.isActive);
  const brainHealth = await getTenantBrain().health();
  const activeLoops = tenant.agentLoops.filter((loop) => loop.enabled);
  const defaultIdentity = tenant.sendingIdentities.find((identity) => identity.isDefault);

  const healthItems: PortalHealthItem[] = [
    {
      key: "tenant",
      label: "Workspace",
      status: tenant.isActive ? "ready" : "blocked",
      detail: tenant.isActive ? "Tenant is active." : "Tenant is inactive.",
      requiredForGoLive: true,
    },
    {
      key: "brand",
      label: "Brand kit",
      status: tenant.logoUrl && brandKit.disclaimer ? "ready" : "warning",
      detail: tenant.logoUrl && brandKit.disclaimer ? "Logo and disclaimer set." : "Logo or disclaimer missing.",
      requiredForGoLive: true,
      href: "/settings",
    },
    {
      key: "drive",
      label: "Google Drive",
      status: tenant.driveConfig?.rootFolderId ? "ready" : "blocked",
      detail: tenant.driveConfig?.rootFolderId ? "Root folder configured." : "Drive root missing.",
      requiredForGoLive: true,
      href: "/settings",
    },
    {
      key: "google",
      label: "Google account",
      status: googleAccountCount > 0 ? "ready" : "blocked",
      detail: googleAccountCount > 0 ? `${googleAccountCount} active Google connection(s).` : "No refresh token available.",
      requiredForGoLive: true,
    },
    {
      key: "hubspot",
      label: "HubSpot",
      status: tenant.hubspotTokens ? "ready" : "warning",
      detail: tenant.hubspotTokens ? `Connected to hub ${tenant.hubspotTokens.hubId}.` : "Not connected.",
      requiredForGoLive: false,
      href: "/settings",
    },
    {
      key: "gbrain",
      label: "GBrain memory",
      status: brainHealth.ok && brainHealth.configured ? "ready" : "warning",
      detail: brainHealth.configured ? brainHealth.error ?? "Memory provider configured." : "Memory provider not configured.",
      requiredForGoLive: true,
      href: "/settings",
    },
    {
      key: "channels",
      label: "Outbound channels",
      status: defaultIdentity || blueBubbles?.status === "healthy" ? "ready" : "warning",
      detail: defaultIdentity
        ? `Default ${defaultIdentity.channel} identity: ${defaultIdentity.displayName}.`
        : blueBubbles
          ? `BlueBubbles is ${blueBubbles.status}.`
          : "No default sending identity.",
      requiredForGoLive: true,
      href: "/settings",
    },
    {
      key: "approvals",
      label: "Review queue",
      status: pendingApprovals + openCompliance === 0 ? "ready" : "warning",
      detail: `${pendingApprovals} approval(s), ${openCompliance} compliance item(s).`,
      requiredForGoLive: false,
      href: "/compliance",
    },
    {
      key: "loops",
      label: "Agent loops",
      status: activeLoops.length > 0 ? "ready" : "warning",
      detail: `${activeLoops.length} loop(s) enabled.`,
      requiredForGoLive: false,
      href: "/settings",
    },
  ];

  const blocking = healthItems.filter((item) => item.requiredForGoLive && item.status === "blocked");
  const warnings = healthItems.filter((item) => item.requiredForGoLive && item.status === "warning");

  return {
    platformOnly: false as const,
    tenant: {
      id: tenant.id,
      name: tenant.brokerageName ?? tenant.name,
      slug: tenant.slug,
      approvalMode: tenant.defaultApprovalMode,
      defaultTone: tenant.defaultTone,
      zillowSources: tenant.zillowProfileSources.length,
      bufferConnected: Boolean(tenant.bufferTokens || process.env.BUFFER_ACCESS_TOKEN?.trim()),
    },
    canManageMembers: user.role === "ADMIN" || user.role === "BROKER_OWNER",
    members,
    healthItems,
    goLive: {
      ready: blocking.length === 0 && warnings.length === 0,
      blocking: blocking.length,
      warnings: warnings.length,
    },
    metrics: {
      pendingApprovals,
      openCompliance,
      unreadNotifications,
      recentRuns: recentRuns.length,
      recentJobs: recentJobs.length,
    },
    recentRuns,
    recentJobs,
    recentAudit,
  };
}
