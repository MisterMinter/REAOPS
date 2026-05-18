import {
  ApprovalMode,
  AgentLoopKind,
  ChannelKind,
  Prisma,
  SendingIdentityType,
  type PrismaClient,
} from "@prisma/client";
import { slugify } from "@/lib/slug";

const DEFAULT_LEAD_SOURCES = [
  "Open house",
  "Referral",
  "Zillow",
  "Website",
  "Sphere",
  "Past client",
  "Paid ad",
  "Manual import",
];

const DEFAULT_PIPELINE_STAGES = [
  "Buyer lead",
  "Seller lead",
  "Active client",
  "Under contract",
  "Closed",
  "Cold nurture",
];

const DEFAULT_RULES = [
  {
    name: "Open house follow-up",
    trigger: "open_house_follow_up",
    channel: ChannelKind.GMAIL,
    approvalMode: ApprovalMode.AUTO_SEND_LOW_RISK,
  },
  {
    name: "Mass nurture outreach",
    trigger: "mass_nurture",
    channel: ChannelKind.GMAIL,
    approvalMode: ApprovalMode.AUTO_SEND_LOW_RISK,
  },
  {
    name: "High-risk seller or contract follow-up",
    trigger: "high_risk_follow_up",
    channel: ChannelKind.GMAIL,
    approvalMode: ApprovalMode.APPROVAL_REQUIRED,
  },
];

const DEFAULT_AGENT_LOOPS = [
  {
    kind: AgentLoopKind.DAILY_OPS,
    name: "Daily Ops Manager",
    cadence: "weekday_morning",
    persona:
      "Direct, warm, lightly opinionated ops manager. Prioritize revenue recovery, approvals, and avoidable drift.",
  },
  {
    kind: AgentLoopKind.FOLLOW_UP_RECOVERY,
    name: "Follow-Up Recovery",
    cadence: "hourly_business_hours",
    persona:
      "Persistent but professional revenue recovery assistant. Create drafts and tasks before things go stale.",
  },
  {
    kind: AgentLoopKind.MARKETING_PLANNING,
    name: "Marketing Planner",
    cadence: "daily",
    persona:
      "Practical listing marketing manager. Turn listing gaps into plans and reusable assets.",
  },
  {
    kind: AgentLoopKind.COMPLIANCE_SWEEP,
    name: "Compliance Sweep",
    cadence: "daily",
    persona:
      "Careful brokerage ops reviewer. Flag deadlines, contract completeness issues, SOP gaps, and fair-housing-sensitive copy.",
  },
];

export async function ensureOpsDefaults(
  prisma: PrismaClient,
  tenantId: string
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, brokerageName: true, flyerNotifyEmail: true },
  });
  if (!tenant) return;

  await Promise.all(
    DEFAULT_LEAD_SOURCES.map((name) =>
      prisma.leadSource.upsert({
        where: { tenantId_slug: { tenantId, slug: slugify(name) } },
        create: { tenantId, name, slug: slugify(name) },
        update: {},
      })
    )
  );

  const pipeline = await prisma.pipeline.upsert({
    where: { tenantId_slug: { tenantId, slug: "default" } },
    create: {
      tenantId,
      name: "Default brokerage pipeline",
      slug: "default",
      isDefault: true,
    },
    update: { isDefault: true },
  });

  for (const [idx, name] of DEFAULT_PIPELINE_STAGES.entries()) {
    await prisma.pipelineStage.upsert({
      where: {
        pipelineId_slug: {
          pipelineId: pipeline.id,
          slug: slugify(name),
        },
      },
      create: {
        pipelineId: pipeline.id,
        name,
        slug: slugify(name),
        position: idx,
        isClosed: name === "Closed",
      },
      update: { position: idx, isClosed: name === "Closed" },
    });
  }

  for (const rule of DEFAULT_RULES) {
    const existing = await prisma.automationRule.findFirst({
      where: { tenantId, trigger: rule.trigger },
      select: { id: true },
    });
    if (!existing) {
      await prisma.automationRule.create({
        data: {
          tenantId,
          name: rule.name,
          trigger: rule.trigger,
          channel: rule.channel,
          approvalMode: rule.approvalMode,
          sendingIdentityType: SendingIdentityType.SHARED_OPS,
        },
      });
    }
  }

  for (const loop of DEFAULT_AGENT_LOOPS) {
    await prisma.agentLoop.upsert({
      where: { tenantId_kind: { tenantId, kind: loop.kind } },
      create: {
        tenantId,
        kind: loop.kind,
        name: loop.name,
        cadence: loop.cadence,
        persona: loop.persona,
        enabled: true,
      },
      update: {
        name: loop.name,
        cadence: loop.cadence,
        persona: loop.persona,
      },
    });
  }

  const identity = await prisma.sendingIdentity.findFirst({
    where: { tenantId, channel: ChannelKind.GMAIL, isDefault: true },
    select: { id: true },
  });
  if (!identity) {
    await prisma.sendingIdentity.create({
      data: {
        tenantId,
        channel: ChannelKind.GMAIL,
        type: SendingIdentityType.SHARED_OPS,
        displayName: `${tenant.brokerageName ?? tenant.name} Ops`,
        email: tenant.flyerNotifyEmail,
        isDefault: true,
      },
    });
  }

  const sop = await prisma.sopTemplate.findFirst({
    where: { tenantId, category: "contract", isDefault: true },
    select: { id: true },
  });
  if (!sop) {
    await prisma.sopTemplate.create({
      data: {
        tenantId,
        title: "Default contract completeness review",
        category: "contract",
        body:
          "Check for completed buyer/seller names, property address, key dates, signatures, required brokerage disclosures, contingency language, and deadline tracking. This is an operational review, not legal advice.",
        checklist: [
          "Parties and property address complete",
          "Price and key dates populated",
          "Required signatures/initials present",
          "Brokerage disclosures attached",
          "Inspection/appraisal/financing deadlines tracked",
          "Fair-housing-sensitive marketing language reviewed",
        ],
        isDefault: true,
      },
    });
  }

  const cachedListings = await prisma.cachedListing.findMany({
    where: { tenantId },
    take: 250,
  });
  for (const cached of cachedListings) {
    const externalId = cached.hubspotId;
    const existing = await prisma.listing.findFirst({
      where: { tenantId, sourceSystem: "cached_listing", externalId },
      select: { id: true },
    });
    const data = {
      address: cached.address,
      shortAddress: cached.shortAddress,
      city: cached.city,
      state: cached.state,
      zip: cached.zip,
      beds: cached.beds,
      baths: cached.baths,
      sqft: cached.sqft,
      price: cached.price,
      priceDisplay: cached.priceDisplay,
      status: cached.status,
      daysOnMarket: cached.daysOnMarket,
      features: cached.features,
      notes: cached.notes,
      mlsNumber: cached.mlsNumber,
      driveFolderId: cached.driveFolderId,
      rawData:
        cached.rawData === null
          ? undefined
          : (cached.rawData as Prisma.InputJsonValue),
    };
    if (existing) {
      await prisma.listing.update({ where: { id: existing.id }, data });
    } else {
      await prisma.listing.create({
        data: {
          tenantId,
          sourceSystem: "cached_listing",
          externalId,
          ...data,
        },
      });
    }
  }
}
