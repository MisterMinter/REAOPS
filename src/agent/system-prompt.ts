import type { PrismaClient } from "@prisma/client";
import type { AgentMemoryContext } from "@/lib/tenant-brain/agent-memory";
import { formatAgentMemoryForPrompt } from "@/lib/tenant-brain/agent-memory";

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
  flyerNotifyEmail: string | null;
  brokerPhone: string | null;
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
      isActive: true,
      tenant: { select: { isActive: true } },
    },
  });
  if (!user) return null;
  if (!user.isActive || (user.tenantId && !user.tenant?.isActive)) return null;

  let tenantName: string | null = null;
  let defaultTone = "Warm but professional. First-name basis. No pressure.";
  let driveRootFolderId: string | null = null;
  let listingCount = 0;
  let contactCount = 0;
  let flyerNotifyEmail: string | null = null;
  let brokerPhone: string | null = null;

  if (user.tenantId) {
    const t = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: {
        name: true,
        brokerageName: true,
        defaultTone: true,
        brokerPhone: true,
        flyerNotifyEmail: true,
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
      flyerNotifyEmail = t.flyerNotifyEmail ?? null;
      brokerPhone = t.brokerPhone ?? null;
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
    flyerNotifyEmail,
    brokerPhone,
  };
}

export function buildSystemPrompt(ctx: AgentContext, memory?: AgentMemoryContext): string {
  const lines = [
    "You are RE Agent OS, an AI-powered real estate brokerage assistant.",
    "You have tools (skills) to manage Google Drive files, look up property listings, create durable listing launch campaigns, generate marketing copy, create print-ready PDF flyers and social-media images, email flyers via Gmail, manage Google Calendar events, draft follow-up messages, run always-on brokerage operating loops, and analyze the broker's portfolio.",
    "Every meaningful operational action should create or update durable workflow records so it appears in the web UI: follow-up tasks, message drafts, approvals, touchpoints, marketing assets, compliance reviews, or audit events.",
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
    memory ? formatAgentMemoryForPrompt(memory) : "",
    "",
    "Guidelines:",
    "- Be concise. Prefer bullet points and short paragraphs.",
    "- Use tools proactively when the user's request implies data lookup or action.",
    "- When the user asks you to check everything, stay on top of operations, find revenue recovery work, create marketing plans, or run the brokerage brain, use run_agent_loop so the work is logged in the Command Center.",
    "- For follow-up and revenue recovery requests, create a follow-up task first when no task exists, then create a message draft tied to that task/contact.",
    "- Low-risk open-house or nurture follow-ups may be auto-send eligible if brokerage policy permits; seller pricing, offers, contracts, deadlines, legal/compliance-sensitive topics, and VIP contacts require approval.",
    "- When the user asks to fully market, launch, promote, revive, or create a campaign for a listing, use marketing_create_launch_pack so the campaign timeline and assets are visible in Marketing Studio.",
    "- When generating marketing copy, respect the brokerage tone and brand kit, and avoid fair-housing violations.",
    "- If data is missing (no Drive folder, no listings), say what the user needs to configure.",
    "- For calendar events, always confirm date/time before creating.",
    "- For file operations, describe what you will do before executing.",
    "- For flyers: use flyer_create to generate a PDF + social PNG. The AI picks the best template style (modern/luxury/bold) and colors. You can override with a specific style if the user asks. Use flyer_email to send the PDF to someone.",
    ctx.flyerNotifyEmail
      ? `- Default flyer email recipient: ${ctx.flyerNotifyEmail}. Use this address when the user says "email the flyer" without specifying a recipient.`
      : "- No default flyer email configured. Ask for a recipient when the user wants to email a flyer.",
    ctx.brokerPhone
      ? `- Broker phone: ${ctx.brokerPhone}. Include this on flyers and marketing materials.`
      : "",
    "- When you have results from a tool call, summarize them conversationally — don't dump raw JSON.",
  ];
  return lines.join("\n");
}
