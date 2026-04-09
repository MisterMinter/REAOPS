import type { PrismaClient } from "@prisma/client";

export type AgentContext = {
  userId: string;
  userEmail: string;
  userName: string | null;
  role: string;
  tenantId: string | null;
  tenantName: string | null;
  defaultTone: string;
  driveRootFolderId: string | null;
  listingCount: number;
  contactCount: number;
  bufferConfigured: boolean;
};

export async function buildAgentContext(
  prisma: PrismaClient,
  userId: string
): Promise<AgentContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      tenantId: true,
    },
  });
  if (!user) return null;

  let tenantName: string | null = null;
  let defaultTone = "Warm but professional. First-name basis. No pressure.";
  let driveRootFolderId: string | null = null;
  let listingCount = 0;
  let contactCount = 0;

  if (user.tenantId) {
    const t = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: {
        name: true,
        brokerageName: true,
        defaultTone: true,
        driveConfig: { select: { rootFolderId: true } },
        _count: { select: { cachedListings: true, cachedContacts: true } },
      },
    });
    if (t) {
      tenantName = t.brokerageName ?? t.name;
      defaultTone = t.defaultTone;
      driveRootFolderId = t.driveConfig?.rootFolderId ?? null;
      listingCount = t._count.cachedListings;
      contactCount = t._count.cachedContacts;
    }
  }

  const bufferConfigured = !!process.env.BUFFER_ACCESS_TOKEN;

  return {
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    role: user.role,
    tenantId: user.tenantId,
    tenantName,
    defaultTone,
    driveRootFolderId,
    listingCount,
    contactCount,
    bufferConfigured,
  };
}

export function buildSystemPrompt(ctx: AgentContext): string {
  const lines = [
    "You are RE Agent OS, an AI-powered real estate brokerage assistant.",
    "You have tools (skills) to manage Google Drive files, look up property listings, generate marketing copy, manage Google Calendar events, draft follow-up messages, and analyze the broker's portfolio.",
    "",
    `User: ${ctx.userName ?? ctx.userEmail} (${ctx.role})`,
    ctx.tenantName ? `Brokerage: ${ctx.tenantName}` : "No brokerage assigned.",
    `Default marketing tone: ${ctx.defaultTone}`,
    ctx.driveRootFolderId
      ? `Drive root folder: ${ctx.driveRootFolderId}`
      : "No Drive root folder configured.",
    `Cached listings: ${ctx.listingCount}. Cached contacts: ${ctx.contactCount}.`,
    ctx.bufferConfigured
      ? "Buffer: connected — you can list profiles and create social media drafts."
      : "Buffer: not configured (BUFFER_ACCESS_TOKEN missing). Mention this if user asks about social posting.",
    "",
    "Guidelines:",
    "- Be concise. Prefer bullet points and short paragraphs.",
    "- Use tools proactively when the user's request implies data lookup or action.",
    "- When generating marketing copy, respect the brokerage tone and avoid fair-housing violations.",
    "- If data is missing (no Drive folder, no listings), say what the user needs to configure.",
    "- For calendar events, always confirm date/time before creating.",
    "- For file operations, describe what you will do before executing.",
    "- When you have results from a tool call, summarize them conversationally — don't dump raw JSON.",
  ];
  return lines.join("\n");
}
