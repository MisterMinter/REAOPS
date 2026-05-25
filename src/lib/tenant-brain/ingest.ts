import {
  AgentRunStatus,
  ApprovalStatus,
  ComplianceReviewStatus,
  FollowUpTaskStatus,
  MarketingCampaignItemStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { parseBrandKit } from "@/lib/marketing/brand-kit";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { getTenantBrain } from "@/lib/tenant-brain";
import type { TenantBrainDocument } from "@/lib/tenant-brain/types";

export async function ingestTenantBusinessFacts(input: {
  prisma?: PrismaClient;
  tenantId: string;
  userId?: string | null;
  reason?: string;
}) {
  const prisma = input.prisma ?? defaultPrisma;
  const documents = await buildTenantBusinessFactDocuments(prisma, input.tenantId);
  try {
    const result = await getTenantBrain().ingest({
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      documents,
      reason: input.reason ?? "business_fact_sync",
    });
    await prisma.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        action: "tenant_brain.ingest",
        subjectType: "Tenant",
        subjectId: input.tenantId,
        metadata: {
          ok: result.ok,
          count: result.count,
          reason: input.reason ?? "business_fact_sync",
          providerConfigured: Boolean(process.env.GBRAIN_BASE_URL?.trim()),
          error: result.error ?? null,
        },
      },
    });
    return result;
  } catch (e) {
    const error = e instanceof Error ? e.message : "Tenant brain ingest failed.";
    await prisma.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        action: "tenant_brain.ingest_failed",
        subjectType: "Tenant",
        subjectId: input.tenantId,
        metadata: { error },
      },
    });
    return { ok: false, count: 0, error };
  }
}

export async function buildTenantBusinessFactDocuments(
  prisma: PrismaClient,
  tenantId: string
): Promise<TenantBrainDocument[]> {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - 14 * 86_400_000);
  const [
    tenant,
    cachedListings,
    listings,
    cachedContacts,
    contacts,
    tasks,
    approvals,
    campaigns,
    complianceReviews,
    sops,
    agentRuns,
  ] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        brokerageName: true,
        defaultTone: true,
        brandKit: true,
        complianceStandard: true,
        brokerPhone: true,
        flyerNotifyEmail: true,
        updatedAt: true,
      },
    }),
    prisma.cachedListing.findMany({
      where: { tenantId },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 80,
    }),
    prisma.listing.findMany({
      where: { tenantId },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 80,
    }),
    prisma.cachedContact.findMany({
      where: { tenantId },
      orderBy: [{ lastContactDate: "asc" }],
      take: 120,
    }),
    prisma.contact.findMany({
      where: { tenantId },
      include: { leadSource: true, pipelineStage: true },
      orderBy: [{ isVip: "desc" }, { updatedAt: "desc" }],
      take: 120,
    }),
    prisma.followUpTask.findMany({
      where: {
        tenantId,
        status: { in: [FollowUpTaskStatus.OPEN, FollowUpTaskStatus.DRAFTED, FollowUpTaskStatus.WAITING_APPROVAL, FollowUpTaskStatus.APPROVED] },
      },
      include: { contact: true, listing: true },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 60,
    }),
    prisma.approval.findMany({
      where: { tenantId, status: ApprovalStatus.PENDING },
      include: { draft: { select: { subject: true, channel: true, risk: true, status: true, contact: true } }, task: true },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    prisma.marketingCampaign.findMany({
      where: { tenantId, status: { in: ["ACTIVE", "PAUSED"] } },
      include: {
        listing: true,
        items: {
          where: { status: { in: [MarketingCampaignItemStatus.DRAFT, MarketingCampaignItemStatus.NEEDS_REVIEW, MarketingCampaignItemStatus.APPROVED, MarketingCampaignItemStatus.SCHEDULED] } },
          orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
          take: 12,
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
    prisma.complianceReview.findMany({
      where: {
        tenantId,
        status: { in: [ComplianceReviewStatus.OPEN, ComplianceReviewStatus.IN_REVIEW, ComplianceReviewStatus.FLAGGED, ComplianceReviewStatus.NEEDS_HUMAN] },
      },
      include: { contact: true, listing: true, sopTemplate: true },
      orderBy: [{ deadlineAt: "asc" }, { updatedAt: "desc" }],
      take: 60,
    }),
    prisma.sopTemplate.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      take: 20,
    }),
    prisma.agentRun.findMany({
      where: { tenantId, status: AgentRunStatus.SUCCEEDED },
      orderBy: { startedAt: "desc" },
      take: 20,
    }),
  ]);

  if (!tenant) return [];

  const brandKit = parseBrandKit(tenant.brandKit);
  const docs: TenantBrainDocument[] = [
    {
      id: `tenant:${tenant.id}:profile`,
      type: "tenant_profile",
      title: `${tenant.brokerageName ?? tenant.name} profile`,
      source: "prisma:Tenant",
      subjectType: "Tenant",
      subjectId: tenant.id,
      updatedAt: tenant.updatedAt.toISOString(),
      content: lines([
        `Brokerage: ${tenant.brokerageName ?? tenant.name}`,
        `Default tone: ${tenant.defaultTone}`,
        `Compliance standard: ${tenant.complianceStandard}`,
        tenant.brokerPhone ? `Broker phone: ${tenant.brokerPhone}` : "",
        tenant.flyerNotifyEmail ? `Default flyer email: ${tenant.flyerNotifyEmail}` : "",
        `Brand style: ${brandKit.fontStyle}`,
        `Brand colors: primary ${brandKit.primaryColor}, secondary ${brandKit.secondaryColor}, accent ${brandKit.accentColor}`,
        brandKit.slogan ? `Brand slogan: ${brandKit.slogan}` : "",
        `Required disclaimer: ${brandKit.disclaimer}`,
      ]),
      metadata: { defaultTone: tenant.defaultTone, brandKit: brandKit as unknown as Prisma.InputJsonValue },
    },
  ];

  for (const listing of cachedListings) {
    docs.push({
      id: `tenant:${tenantId}:cached-listing:${listing.id}`,
      type: "listing",
      title: `Listing ${listing.shortAddress || listing.address}`,
      source: "prisma:CachedListing",
      subjectType: "CachedListing",
      subjectId: listing.id,
      updatedAt: listing.updatedAt.toISOString(),
      content: lines([
        `Address: ${listing.address}`,
        `Status: ${listing.status}`,
        `Price: ${listing.priceDisplay}`,
        listing.daysOnMarket != null ? `Days on market: ${listing.daysOnMarket}` : "",
        listing.beds != null ? `Beds: ${listing.beds}` : "",
        listing.baths != null ? `Baths: ${listing.baths}` : "",
        listing.sqft != null ? `Sq ft: ${listing.sqft}` : "",
        listing.mlsNumber ? `MLS: ${listing.mlsNumber}` : "",
        listing.driveFolderId ? `Drive folder linked: yes` : "Drive folder linked: no",
        listing.features ? `Features: ${truncate(listing.features, 600)}` : "",
      ]),
    });
  }

  for (const listing of listings) {
    docs.push({
      id: `tenant:${tenantId}:listing:${listing.id}`,
      type: "ops_listing",
      title: `Ops listing ${listing.shortAddress || listing.address}`,
      source: "prisma:Listing",
      subjectType: "Listing",
      subjectId: listing.id,
      updatedAt: listing.updatedAt.toISOString(),
      content: lines([
        `Address: ${listing.address}`,
        `Status: ${listing.status}`,
        listing.priceDisplay ? `Price: ${listing.priceDisplay}` : "",
        listing.daysOnMarket != null ? `Days on market: ${listing.daysOnMarket}` : "",
        listing.features ? `Features: ${truncate(listing.features, 600)}` : "",
      ]),
    });
  }

  const staleCachedContacts = cachedContacts.filter((c) => !c.lastContactDate || c.lastContactDate < staleCutoff);
  docs.push({
    id: `tenant:${tenantId}:contact-summary`,
    type: "contact_summary",
    title: "Contact and lead summary",
    source: "prisma:CachedContact+Contact",
    subjectType: "Tenant",
    subjectId: tenantId,
    updatedAt: now.toISOString(),
    content: lines([
      `Cached CRM contacts: ${cachedContacts.length}`,
      `REAOPS contacts: ${contacts.length}`,
      `Stale cached contacts needing follow-up: ${staleCachedContacts.length}`,
      staleCachedContacts.slice(0, 12).map((c) => `Stale: ${contactName(c)} (${c.leadStatus ?? "unknown"}) last touch ${formatDate(c.lastContactDate)}`).join("\n"),
    ]),
  });

  for (const contact of contacts.slice(0, 50)) {
    docs.push({
      id: `tenant:${tenantId}:contact:${contact.id}`,
      type: "contact",
      title: `Contact ${contactName(contact)}`,
      source: "prisma:Contact",
      subjectType: "Contact",
      subjectId: contact.id,
      updatedAt: contact.updatedAt.toISOString(),
      content: lines([
        `Name: ${contactName(contact)}`,
        `Status: ${contact.status}`,
        contact.isVip ? "VIP: yes" : "",
        contact.leadSource?.name ? `Lead source: ${contact.leadSource.name}` : "",
        contact.pipelineStage?.name ? `Pipeline stage: ${contact.pipelineStage.name}` : "",
        contact.lastContactAt ? `Last contact: ${formatDate(contact.lastContactAt)}` : "Last contact: never",
        contact.nextActionAt ? `Next action: ${formatDate(contact.nextActionAt)}` : "",
        contact.notes ? `Notes: ${truncate(contact.notes, 400)}` : "",
      ]),
    });
  }

  for (const task of tasks) {
    docs.push({
      id: `tenant:${tenantId}:follow-up-task:${task.id}`,
      type: "follow_up_task",
      title: task.title,
      source: "prisma:FollowUpTask",
      subjectType: "FollowUpTask",
      subjectId: task.id,
      updatedAt: task.updatedAt.toISOString(),
      content: lines([
        `Task: ${task.title}`,
        `Status: ${task.status}`,
        `Risk: ${task.risk}`,
        `Priority: ${task.priority}`,
        task.dueAt ? `Due: ${formatDate(task.dueAt)}` : "",
        task.contact ? `Contact: ${contactName(task.contact)}` : "",
        task.listing ? `Listing: ${task.listing.shortAddress || task.listing.address}` : "",
        task.context ? `Context: ${truncate(task.context, 500)}` : "",
      ]),
    });
  }

  for (const approval of approvals) {
    docs.push({
      id: `tenant:${tenantId}:approval:${approval.id}`,
      type: "approval",
      title: approval.draft?.subject ?? approval.task?.title ?? "Pending approval",
      source: "prisma:Approval",
      subjectType: "Approval",
      subjectId: approval.id,
      updatedAt: approval.updatedAt.toISOString(),
      content: lines([
        `Pending approval: ${approval.draft?.subject ?? approval.task?.title ?? "Draft approval"}`,
        approval.draft?.channel ? `Channel: ${approval.draft.channel}` : "",
        approval.draft?.risk ? `Risk: ${approval.draft.risk}` : "",
        approval.draft?.contact ? `Contact: ${contactName(approval.draft.contact)}` : "",
        approval.task?.title ? `Task: ${approval.task.title}` : "",
      ]),
    });
  }

  for (const campaign of campaigns) {
    docs.push({
      id: `tenant:${tenantId}:marketing-campaign:${campaign.id}`,
      type: "marketing_campaign",
      title: campaign.title,
      source: "prisma:MarketingCampaign",
      subjectType: "MarketingCampaign",
      subjectId: campaign.id,
      updatedAt: campaign.updatedAt.toISOString(),
      content: lines([
        `Campaign: ${campaign.title}`,
        `Goal: ${campaign.goal}`,
        `Status: ${campaign.status}`,
        campaign.summary ? `Summary: ${truncate(campaign.summary, 700)}` : "",
        campaign.listing ? `Listing: ${campaign.listing.shortAddress || campaign.listing.address}` : "",
        campaign.items.map((item) => `Item: ${item.title} | ${item.stage}/${item.channel} | ${item.status} | due ${formatDate(item.dueAt)}`).join("\n"),
      ]),
    });
  }

  for (const review of complianceReviews) {
    docs.push({
      id: `tenant:${tenantId}:compliance-review:${review.id}`,
      type: "compliance_review",
      title: review.title,
      source: "prisma:ComplianceReview",
      subjectType: "ComplianceReview",
      subjectId: review.id,
      updatedAt: review.updatedAt.toISOString(),
      content: lines([
        `Review: ${review.title}`,
        `Status: ${review.status}`,
        review.deadlineAt ? `Deadline: ${formatDate(review.deadlineAt)}` : "",
        review.contact ? `Contact: ${contactName(review.contact)}` : "",
        review.listing ? `Listing: ${review.listing.shortAddress || review.listing.address}` : "",
        review.sopTemplate ? `SOP: ${review.sopTemplate.title}` : "",
        review.summary ? `Summary: ${truncate(review.summary, 700)}` : "",
        Array.isArray(review.flags) ? `Flags: ${review.flags.join("; ")}` : "",
      ]),
    });
  }

  for (const sop of sops) {
    docs.push({
      id: `tenant:${tenantId}:sop:${sop.id}`,
      type: "sop",
      title: sop.title,
      source: "prisma:SopTemplate",
      subjectType: "SopTemplate",
      subjectId: sop.id,
      updatedAt: sop.updatedAt.toISOString(),
      content: lines([
        `SOP: ${sop.title}`,
        `Category: ${sop.category}`,
        sop.isDefault ? "Default SOP: yes" : "",
        truncate(sop.body, 1200),
      ]),
    });
  }

  for (const run of agentRuns) {
    docs.push({
      id: `tenant:${tenantId}:agent-run:${run.id}`,
      type: "agent_run_summary",
      title: `${run.kind} run ${formatDate(run.startedAt)}`,
      source: "prisma:AgentRun",
      subjectType: "AgentRun",
      subjectId: run.id,
      updatedAt: (run.finishedAt ?? run.startedAt).toISOString(),
      content: lines([
        `Run: ${run.kind}`,
        `Trigger: ${run.trigger}`,
        `Status: ${run.status}`,
        run.summary ? `Summary: ${truncate(run.summary, 900)}` : "",
      ]),
    });
  }

  return docs.filter((doc) => doc.content.trim());
}

function contactName(contact: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}) {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() || contact.email || contact.phone || "Contact";
}

function formatDate(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "not set";
}

function lines(values: Array<string | null | undefined | false>) {
  return values.filter((v): v is string => typeof v === "string" && v.trim().length > 0).join("\n");
}

function truncate(value: string, max: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}
