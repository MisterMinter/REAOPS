import {
  AgentLoopKind,
  AgentRunStatus,
  ChannelKind,
  ComplianceReviewStatus,
  MarketingAssetType,
  MessageRisk,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { generateText } from "ai";
import { resolveLanguageModel } from "@/lib/ai-chat";
import { ensureOpsDefaults } from "@/lib/ops/defaults";
import {
  contactDisplayName,
  createComplianceReview,
  createFollowUpTask,
  draftMessage,
  generateMarketingAsset,
  type Actor,
} from "@/lib/ops/workflows";
import { prisma as defaultPrisma } from "@/lib/prisma";

type LoopAction = {
  type: string;
  id?: string;
  label: string;
  href?: string;
  status?: string;
};

type LoopObservation = {
  type: string;
  label: string;
  detail?: string;
  count?: number;
};

export type AgentLoopRunResult = {
  runId: string;
  kind: AgentLoopKind;
  summary: string;
  observations: LoopObservation[];
  actions: LoopAction[];
};

export async function runAgentLoop(input: {
  prisma?: PrismaClient;
  tenantId: string;
  kind: AgentLoopKind;
  trigger?: string;
  actorUserId?: string | null;
}): Promise<AgentLoopRunResult> {
  const prisma = input.prisma ?? defaultPrisma;
  await ensureOpsDefaults(prisma, input.tenantId);

  const loop = await prisma.agentLoop.upsert({
    where: { tenantId_kind: { tenantId: input.tenantId, kind: input.kind } },
    create: {
      tenantId: input.tenantId,
      kind: input.kind,
      name: loopName(input.kind),
      cadence: "manual",
      enabled: true,
    },
    update: {},
  });

  const run = await prisma.agentRun.create({
    data: {
      tenantId: input.tenantId,
      loopId: loop.id,
      kind: input.kind,
      trigger: input.trigger ?? "manual",
      status: AgentRunStatus.RUNNING,
    },
  });

  const actor = await resolveActor(prisma, input.tenantId, input.actorUserId);

  try {
    const result =
      input.kind === AgentLoopKind.FOLLOW_UP_RECOVERY
        ? await runFollowUpRecovery(prisma, actor, loop.persona)
        : input.kind === AgentLoopKind.MARKETING_PLANNING
          ? await runMarketingPlanning(prisma, actor, loop.persona)
          : input.kind === AgentLoopKind.COMPLIANCE_SWEEP
            ? await runComplianceSweep(prisma, actor, loop.persona)
            : await runDailyOps(prisma, actor, loop.persona);

    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: AgentRunStatus.SUCCEEDED,
        summary: result.summary,
        observations: result.observations as unknown as Prisma.InputJsonValue,
        actions: result.actions as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
    await prisma.agentLoop.update({
      where: { id: loop.id },
      data: { lastRunAt: new Date() },
    });

    await prisma.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        userId: actor.id,
        action: "agent.loop.run",
        subjectType: "AgentRun",
        subjectId: run.id,
        metadata: { kind: input.kind, trigger: input.trigger ?? "manual" },
      },
    });

    return { runId: run.id, kind: input.kind, ...result };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Agent loop failed.";
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: AgentRunStatus.FAILED,
        error,
        finishedAt: new Date(),
      },
    });
    throw e;
  }
}

export async function runEnabledAgentLoops(input: {
  prisma?: PrismaClient;
  tenantId: string;
  trigger?: string;
  respectCadence?: boolean;
}): Promise<AgentLoopRunResult[]> {
  const prisma = input.prisma ?? defaultPrisma;
  await ensureOpsDefaults(prisma, input.tenantId);
  let loops = await prisma.agentLoop.findMany({
    where: { tenantId: input.tenantId, enabled: true },
    orderBy: { kind: "asc" },
  });
  if (input.respectCadence) {
    loops = loops.filter(loopIsDue);
  }
  const results: AgentLoopRunResult[] = [];
  for (const loop of loops) {
    results.push(
      await runAgentLoop({
        prisma,
        tenantId: input.tenantId,
        kind: loop.kind,
        trigger: input.trigger ?? "scheduled",
      })
    );
  }
  return results;
}

function loopIsDue(loop: { cadence: string; lastRunAt: Date | null }) {
  if (!loop.lastRunAt) return true;
  const elapsed = Date.now() - loop.lastRunAt.getTime();
  const cadence = loop.cadence.toLowerCase();

  if (cadence.includes("manual")) return false;
  if (cadence.includes("hour")) return elapsed >= 55 * 60 * 1000;
  if (cadence.includes("weekday") || cadence.includes("daily")) {
    return elapsed >= 20 * 60 * 60 * 1000;
  }
  if (cadence.includes("week")) return elapsed >= 6 * 24 * 60 * 60 * 1000;

  return elapsed >= 20 * 60 * 60 * 1000;
}

async function runDailyOps(prisma: PrismaClient, actor: Actor, persona?: string | null) {
  const [followUp, marketing, compliance] = await Promise.all([
    inspectFollowUpRecovery(prisma, actor, { create: true }),
    inspectMarketingPlanning(prisma, actor, { create: true }),
    inspectCompliance(prisma, actor, { create: true }),
  ]);

  const observations = [
    ...followUp.observations,
    ...marketing.observations,
    ...compliance.observations,
  ];
  const actions = [
    ...followUp.actions,
    ...marketing.actions,
    ...compliance.actions,
  ];

  const summary = await summarizeLoop({
    persona: persona
      ? `You are REAOPS, an always-on real estate operations manager. Persona: ${persona}`
      : "You are REAOPS, an always-on real estate operations manager. Be direct, warm, lightly opinionated, and specific. Say what you found, what you created, and what needs human attention.",
    observations,
    actions,
    fallback: `I found ${observations.length} operational signals and created ${actions.length} action(s).`,
  });

  return { summary, observations, actions };
}

async function runFollowUpRecovery(
  prisma: PrismaClient,
  actor: Actor,
  persona?: string | null
) {
  return inspectFollowUpRecovery(prisma, actor, { create: true, persona });
}

async function runMarketingPlanning(
  prisma: PrismaClient,
  actor: Actor,
  persona?: string | null
) {
  return inspectMarketingPlanning(prisma, actor, { create: true, persona });
}

async function runComplianceSweep(
  prisma: PrismaClient,
  actor: Actor,
  persona?: string | null
) {
  return inspectCompliance(prisma, actor, { create: true, persona });
}

async function inspectFollowUpRecovery(
  prisma: PrismaClient,
  actor: Actor,
  opts?: { create?: boolean; persona?: string | null }
) {
  const staleCutoff = new Date(Date.now() - 14 * 86_400_000);
  const contacts = await prisma.contact.findMany({
    where: {
      tenantId: actor.tenantId,
      OR: [{ lastContactAt: null }, { lastContactAt: { lt: staleCutoff } }],
    },
    include: {
      leadSource: true,
      followUpTasks: {
        where: { status: { in: ["OPEN", "DRAFTED", "WAITING_APPROVAL", "APPROVED"] } },
        take: 1,
      },
    },
    orderBy: [{ isVip: "desc" }, { lastContactAt: "asc" }],
    take: 8,
  });

  const actionable = contacts.filter((c) => c.followUpTasks.length === 0);
  const observations: LoopObservation[] = [
    {
      type: "stale_contacts",
      label: "Contacts needing attention",
      count: contacts.length,
      detail: `${contacts.length} contact(s) have no recent touchpoint.`,
    },
  ];
  const actions: LoopAction[] = [];

  if (opts?.create) {
    for (const contact of actionable.slice(0, 5)) {
      const name = contactDisplayName(contact);
      const context = `${name} is stale. Lead source: ${contact.leadSource?.name ?? "unknown"}. Last touch: ${
        contact.lastContactAt ? contact.lastContactAt.toLocaleDateString() : "never"
      }.`;
      const task = await createFollowUpTask({
        prisma,
        actor,
        contactId: contact.id,
        ownerUserId: contact.ownerUserId,
        title: `Recover follow-up: ${name}`,
        context,
        source: "agent_follow_up_recovery",
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        risk: contact.isVip ? MessageRisk.MEDIUM : MessageRisk.LOW,
        priority: contact.isVip ? 1 : 2,
      });
      const draft = await draftMessage({
        prisma,
        actor,
        taskId: task.id,
        contactId: contact.id,
        channel: ChannelKind.GMAIL,
        context,
      });
      actions.push({
        type: "follow_up_task",
        id: task.id,
        label: `Created task and draft for ${name}`,
        href: "/follow-up",
        status: `draft ${draft.status}`,
      });
    }
  }

  const summary = await summarizeLoop({
    persona:
      opts?.persona ??
      "You are a persistent but professional real estate revenue recovery assistant. Focus on stale contacts and next actions.",
    observations,
    actions,
    fallback: `Found ${contacts.length} stale contact(s); created ${actions.length} follow-up action(s).`,
  });
  return { summary, observations, actions };
}

async function inspectMarketingPlanning(
  prisma: PrismaClient,
  actor: Actor,
  opts?: { create?: boolean; persona?: string | null }
) {
  const listings = await prisma.listing.findMany({
    where: { tenantId: actor.tenantId, status: { contains: "Active", mode: "insensitive" } },
    include: { marketingAssets: { where: { type: MarketingAssetType.SOCIAL_COPY }, take: 1 } },
    orderBy: [{ daysOnMarket: "desc" }, { updatedAt: "desc" }],
    take: 10,
  });
  const needingPlan = listings.filter((l) => l.marketingAssets.length === 0);
  const observations: LoopObservation[] = [
    {
      type: "marketing_gaps",
      label: "Listings missing fresh social plan",
      count: needingPlan.length,
      detail: `${needingPlan.length} active listing(s) do not have a stored social copy asset.`,
    },
  ];
  const actions: LoopAction[] = [];

  if (opts?.create) {
    for (const listing of needingPlan.slice(0, 5)) {
      const content = await generateListingMarketingPlan(listing);
      const asset = await generateMarketingAsset({
        prisma,
        actor,
        listingId: listing.id,
        type: MarketingAssetType.SOCIAL_COPY,
        title: `Social plan - ${listing.shortAddress || listing.address}`,
        content,
        metadata: {
          generatedBy: "agent_loop",
          daysOnMarket: listing.daysOnMarket,
          status: listing.status,
        },
      });
      actions.push({
        type: "marketing_asset",
        id: asset.id,
        label: `Created social plan for ${listing.shortAddress || listing.address}`,
        href: "/marketing",
        status: asset.status,
      });
    }
  }

  const summary = await summarizeLoop({
    persona:
      opts?.persona ??
      "You are a practical real estate listing marketing manager. Turn listing gaps into concrete content plans.",
    observations,
    actions,
    fallback: `Found ${needingPlan.length} marketing gap(s); created ${actions.length} marketing asset(s).`,
  });
  return { summary, observations, actions };
}

async function inspectCompliance(
  prisma: PrismaClient,
  actor: Actor,
  opts?: { create?: boolean; persona?: string | null }
) {
  const existingOpen = await prisma.complianceReview.count({
    where: {
      tenantId: actor.tenantId,
      status: { in: [ComplianceReviewStatus.OPEN, ComplianceReviewStatus.FLAGGED, ComplianceReviewStatus.NEEDS_HUMAN] },
    },
  });
  const highRiskDrafts = await prisma.messageDraft.findMany({
    where: {
      tenantId: actor.tenantId,
      risk: "HIGH",
      status: { in: ["DRAFT", "WAITING_APPROVAL", "APPROVED"] },
    },
    include: { contact: true, task: true },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  const observations: LoopObservation[] = [
    {
      type: "open_compliance",
      label: "Open compliance reviews",
      count: existingOpen,
      detail: `${existingOpen} compliance review(s) are open or flagged.`,
    },
    {
      type: "high_risk_drafts",
      label: "High-risk drafts needing review",
      count: highRiskDrafts.length,
      detail: `${highRiskDrafts.length} high-risk message draft(s) may need SOP/fair-housing review.`,
    },
  ];
  const actions: LoopAction[] = [];

  if (opts?.create) {
    for (const draft of highRiskDrafts.slice(0, 4)) {
      const existing = await prisma.complianceReview.findFirst({
        where: {
          tenantId: actor.tenantId,
          title: `Review high-risk draft: ${draft.subject ?? draft.task?.title ?? "Message"}`,
        },
        select: { id: true },
      });
      if (existing) continue;
      const review = await createComplianceReview({
        prisma,
        actor,
        title: `Review high-risk draft: ${draft.subject ?? draft.task?.title ?? "Message"}`,
        summary: `Agent loop flagged a ${draft.risk} ${draft.channel} draft for ${
          draft.contact ? contactDisplayName(draft.contact) : "a contact"
        }. Review for contract/deadline/legal/fair-housing-sensitive language before sending.`,
        contactId: draft.contactId,
        flags: [
          `Message risk: ${draft.risk}`,
          "Human approval required before sensitive language is sent.",
        ],
      });
      actions.push({
        type: "compliance_review",
        id: review.id,
        label: `Created compliance review for ${draft.contact ? contactDisplayName(draft.contact) : "draft"}`,
        href: "/compliance",
        status: review.status,
      });
    }
  }

  const summary = await summarizeLoop({
    persona:
      opts?.persona ??
      "You are a careful brokerage operations reviewer. Flag compliance issues without giving legal advice.",
    observations,
    actions,
    fallback: `Found ${existingOpen} open review(s) and ${highRiskDrafts.length} high-risk draft(s); created ${actions.length} compliance action(s).`,
  });
  return { summary, observations, actions };
}

async function summarizeLoop(input: {
  persona: string;
  observations: LoopObservation[];
  actions: LoopAction[];
  fallback: string;
}): Promise<string> {
  const model = resolveLanguageModel();
  if (!model) return input.fallback;

  try {
    const result = await generateText({
      model,
      system: `${input.persona} Keep it under 700 characters. No emojis. Mention what was created and what needs approval when relevant.`,
      prompt: JSON.stringify(
        {
          observations: input.observations,
          actions: input.actions,
        },
        null,
        2
      ),
    });
    return result.text.trim();
  } catch {
    return input.fallback;
  }
}

async function generateListingMarketingPlan(listing: {
  address: string;
  shortAddress: string;
  city: string | null;
  state: string | null;
  priceDisplay: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  daysOnMarket: number | null;
  features: string | null;
}) {
  const model = resolveLanguageModel();
  const facts = [
    listing.address,
    listing.city || listing.state ? `${listing.city ?? ""}, ${listing.state ?? ""}` : "",
    listing.priceDisplay ? `Price: ${listing.priceDisplay}` : "",
    listing.beds != null ? `${listing.beds} beds` : "",
    listing.baths != null ? `${listing.baths} baths` : "",
    listing.sqft != null ? `${listing.sqft.toLocaleString()} sqft` : "",
    listing.daysOnMarket != null ? `${listing.daysOnMarket} days on market` : "",
    listing.features ? `Features: ${listing.features}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (!model) {
    return `Weekly social plan for ${listing.shortAddress || listing.address}:\n1. Listing highlight post\n2. Feature-focused story\n3. Buyer FAQ post\n4. Open house reminder\n5. Seller update/adaptation if days-on-market continues to climb.`;
  }

  const result = await generateText({
    model,
    system:
      "You are a real estate marketing manager. Create a concise 5-item social/content plan for a listing. Avoid fair-housing-sensitive language.",
    prompt: facts,
  });
  return result.text.trim();
}

async function resolveActor(
  prisma: PrismaClient,
  tenantId: string,
  actorUserId?: string | null
): Promise<Actor> {
  if (actorUserId) {
    const user = await prisma.user.findFirst({
      where: { id: actorUserId, tenantId },
      select: { id: true, role: true },
    });
    if (user) return { id: user.id, tenantId, role: user.role };
  }
  const owner = await prisma.user.findFirst({
    where: { tenantId, isActive: true, role: { in: ["BROKER_OWNER", "ADMIN"] } },
    select: { id: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  if (owner) return { id: owner.id, tenantId, role: owner.role };
  const anyUser = await prisma.user.findFirst({
    where: { tenantId, isActive: true },
    select: { id: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  if (anyUser) return { id: anyUser.id, tenantId, role: anyUser.role };
  throw new Error("No active user found for brokerage.");
}

function loopName(kind: AgentLoopKind): string {
  switch (kind) {
    case AgentLoopKind.DAILY_OPS:
      return "Daily Ops Manager";
    case AgentLoopKind.FOLLOW_UP_RECOVERY:
      return "Follow-Up Recovery";
    case AgentLoopKind.MARKETING_PLANNING:
      return "Marketing Planner";
    case AgentLoopKind.COMPLIANCE_SWEEP:
      return "Compliance Sweep";
  }
}
