import {
  ApprovalStatus,
  ComplianceReviewStatus,
  FollowUpTaskStatus,
  JobRunStatus,
  type PrismaClient,
} from "@prisma/client";
import { withJobRun } from "@/lib/jobs";
import { getTenantBrain } from "@/lib/tenant-brain";
import {
  buildTenantBusinessFactDocuments,
  ingestTenantBusinessFacts,
} from "@/lib/tenant-brain/ingest";
import type {
  TenantBrainGap,
  TenantBrainGapsResult,
  TenantBrainHealth,
  TenantBrainMemory,
} from "@/lib/tenant-brain/types";

export type TenantBrainOpsSnapshot = {
  health: TenantBrainHealth;
  providerGaps: TenantBrainGapsResult;
  localStaleFacts: TenantBrainGap[];
  documentCount: number;
  lastIngest: {
    at: Date;
    ok: boolean;
    count: number | null;
    reason: string | null;
    error: string | null;
  } | null;
  failedOperations24h: number;
  lastBackfillJob: {
    id: string;
    status: JobRunStatus;
    summary: string | null;
    error: string | null;
    startedAt: Date;
    finishedAt: Date | null;
  } | null;
  citations: string[];
  isolation: TenantBrainIsolationVerification;
};

export type TenantBrainIsolationVerification = {
  ok: boolean;
  status: "pass" | "degraded" | "failed";
  checkedAt: string;
  detail: string;
  citations: string[];
  foreignMemoryIds: string[];
};

export async function getTenantBrainOpsSnapshot(input: {
  prisma: PrismaClient;
  tenantId: string;
  userId?: string | null;
}): Promise<TenantBrainOpsSnapshot> {
  const brain = getTenantBrain();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [
    health,
    providerGaps,
    localStaleFacts,
    documents,
    lastIngestEvent,
    failedOperations24h,
    lastBackfillJob,
    citationQuery,
    isolation,
  ] = await Promise.all([
    brain.health(),
    brain
      .gaps({
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        limit: 12,
      })
      .catch((e) => ({
        gaps: [],
        stale: [],
        citations: [],
        degraded: true,
        error: e instanceof Error ? e.message : "Tenant brain gap analysis failed.",
      })),
    getLocalStaleFacts(input.prisma, input.tenantId),
    buildTenantBusinessFactDocuments(input.prisma, input.tenantId),
    input.prisma.auditEvent.findFirst({
      where: {
        tenantId: input.tenantId,
        action: { in: ["tenant_brain.ingest", "tenant_brain.ingest_failed"] },
      },
      orderBy: { createdAt: "desc" },
      select: { action: true, createdAt: true, metadata: true },
    }),
    input.prisma.auditEvent.count({
      where: {
        tenantId: input.tenantId,
        createdAt: { gte: since24h },
        action: {
          in: [
            "tenant_brain.ingest_failed",
            "tenant_brain.query_failed",
            "tenant_brain.gap_failed",
            "tenant_brain.maintenance_failed",
          ],
        },
      },
    }),
    input.prisma.jobRun.findFirst({
      where: { tenantId: input.tenantId, kind: "tenant_brain_backfill" },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        status: true,
        summary: true,
        error: true,
        startedAt: true,
        finishedAt: true,
      },
    }),
    brain
      .query({
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        query: "Brokerage profile, brand direction, active listings, SOPs, pending approvals, stale facts.",
        limit: 5,
      })
      .catch((e) => ({
        memories: [],
        citations: [],
        degraded: true,
        error: e instanceof Error ? e.message : "Tenant brain citation query failed.",
      })),
    verifyTenantBrainIsolation({
      tenantId: input.tenantId,
      userId: input.userId ?? null,
    }),
  ]);

  const failedGapCount = providerGaps.error ? 1 : 0;
  if (failedGapCount > 0) {
    await input.prisma.auditEvent
      .create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId ?? null,
          action: "tenant_brain.gap_failed",
          subjectType: "Tenant",
          subjectId: input.tenantId,
          metadata: { error: providerGaps.error },
        },
      })
      .catch(() => undefined);
  }

  return {
    health,
    providerGaps,
    localStaleFacts,
    documentCount: documents.length,
    lastIngest: normalizeLastIngest(lastIngestEvent),
    failedOperations24h: failedOperations24h + failedGapCount,
    lastBackfillJob,
    citations: unique([
      ...providerGaps.citations,
      ...citationQuery.citations,
      ...citationsFromMemories(citationQuery.memories),
    ]).slice(0, 10),
    isolation,
  };
}

export async function backfillTenantBrain(input: {
  prisma: PrismaClient;
  tenantId: string;
  userId?: string | null;
  trigger?: string;
  reason?: string;
}) {
  return withJobRun({
    prisma: input.prisma,
    tenantId: input.tenantId,
    kind: "tenant_brain_backfill",
    key: `tenant-brain-backfill:${input.tenantId}`,
    trigger: input.trigger ?? "manual",
    ttlMs: 15 * 60 * 1000,
    metadata: { reason: input.reason ?? "manual_memory_backfill" },
    summarize: (result) => `Backfilled ${result.count} tenant brain document(s).`,
    resultMetadata: (result) => ({
      reason: input.reason ?? "manual_memory_backfill",
      ok: result.ok,
      count: result.count,
      error: result.error ?? null,
    }),
    run: async () => {
      const result = await ingestTenantBusinessFacts({
        prisma: input.prisma,
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        reason: input.reason ?? "manual_memory_backfill",
      });
      if (!result.ok) throw new Error(result.error ?? "Tenant brain backfill failed.");
      return result;
    },
  });
}

export async function maintainTenantBrain(input: {
  prisma: PrismaClient;
  tenantId: string;
  userId?: string | null;
  trigger?: string;
  reason?: string;
}) {
  return withJobRun({
    prisma: input.prisma,
    tenantId: input.tenantId,
    kind: "tenant_brain_maintenance",
    key: `tenant-brain-maintenance:${input.tenantId}`,
    trigger: input.trigger ?? "cron",
    ttlMs: 20 * 60 * 1000,
    metadata: { reason: input.reason ?? "scheduled_memory_maintenance" },
    summarize: (result) =>
      result.skipped
        ? "Tenant brain maintenance skipped by provider."
        : "Tenant brain maintenance completed.",
    resultMetadata: (result) => ({
      reason: input.reason ?? "scheduled_memory_maintenance",
      ok: result.ok,
      skipped: result.skipped ?? false,
      error: result.error ?? null,
    }),
    run: async () => {
      try {
        const result = await getTenantBrain().consolidate({
          tenantId: input.tenantId,
          userId: input.userId ?? null,
          reason: input.reason ?? "scheduled_memory_maintenance",
        });
        if (!result.ok) throw new Error(result.error ?? "Tenant brain maintenance failed.");
        return result;
      } catch (e) {
        await input.prisma.auditEvent.create({
          data: {
            tenantId: input.tenantId,
            userId: input.userId ?? null,
            action: "tenant_brain.maintenance_failed",
            subjectType: "Tenant",
            subjectId: input.tenantId,
            metadata: { error: e instanceof Error ? e.message : "Tenant brain maintenance failed." },
          },
        });
        throw e;
      }
    },
  });
}

export async function verifyTenantBrainIsolation(input: {
  tenantId: string;
  userId?: string | null;
}): Promise<TenantBrainIsolationVerification> {
  const checkedAt = new Date().toISOString();
  try {
    const result = await getTenantBrain().query({
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      query: `Tenant isolation verification for namespace tenant:${input.tenantId}.`,
      limit: 8,
    });
    if (result.degraded) {
      return {
        ok: false,
        status: "degraded",
        checkedAt,
        detail: result.error ?? "GBrain is not configured, so provider isolation could not be checked.",
        citations: result.citations,
        foreignMemoryIds: [],
      };
    }

    const foreignMemoryIds = result.memories
      .filter((memory) => {
        const scopedTenant = tenantIdFromMemory(memory);
        return scopedTenant != null && scopedTenant !== input.tenantId;
      })
      .map((memory) => memory.id);

    return {
      ok: foreignMemoryIds.length === 0,
      status: foreignMemoryIds.length === 0 ? "pass" : "failed",
      checkedAt,
      detail:
        foreignMemoryIds.length === 0
          ? `GBrain query was scoped to tenant:${input.tenantId}; no foreign tenant markers were returned.`
          : `GBrain returned ${foreignMemoryIds.length} memory item(s) marked for another tenant.`,
      citations: result.citations,
      foreignMemoryIds,
    };
  } catch (e) {
    return {
      ok: false,
      status: "degraded",
      checkedAt,
      detail: e instanceof Error ? e.message : "Tenant brain isolation check failed.",
      citations: [],
      foreignMemoryIds: [],
    };
  }
}

async function getLocalStaleFacts(prisma: PrismaClient, tenantId: string): Promise<TenantBrainGap[]> {
  const staleContactCutoff = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
  const staleApprovalCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const [listingsMissingDrive, staleContacts, staleCachedContacts, oldApprovals, openCompliance, overdueTasks] =
    await Promise.all([
      prisma.listing.findMany({
        where: {
          tenantId,
          status: { in: ["Active", "ACTIVE", "For Sale", "Coming Soon"] },
          driveFolderId: null,
        },
        select: { id: true, shortAddress: true, address: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 8,
      }),
      prisma.contact.findMany({
        where: {
          tenantId,
          OR: [{ lastContactAt: null }, { lastContactAt: { lt: staleContactCutoff } }],
        },
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, lastContactAt: true },
        orderBy: [{ lastContactAt: "asc" }, { updatedAt: "desc" }],
        take: 8,
      }),
      prisma.cachedContact.findMany({
        where: {
          tenantId,
          OR: [{ lastContactDate: null }, { lastContactDate: { lt: staleContactCutoff } }],
        },
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, lastContactDate: true },
        orderBy: [{ lastContactDate: "asc" }, { updatedAt: "desc" }],
        take: 8,
      }),
      prisma.approval.findMany({
        where: { tenantId, status: ApprovalStatus.PENDING, createdAt: { lt: staleApprovalCutoff } },
        select: { id: true, createdAt: true, draft: { select: { subject: true } }, task: { select: { title: true } } },
        orderBy: { createdAt: "asc" },
        take: 8,
      }),
      prisma.complianceReview.findMany({
        where: {
          tenantId,
          status: {
            in: [
              ComplianceReviewStatus.OPEN,
              ComplianceReviewStatus.IN_REVIEW,
              ComplianceReviewStatus.FLAGGED,
              ComplianceReviewStatus.NEEDS_HUMAN,
            ],
          },
        },
        select: { id: true, title: true, status: true, deadlineAt: true, updatedAt: true },
        orderBy: [{ deadlineAt: "asc" }, { updatedAt: "asc" }],
        take: 8,
      }),
      prisma.followUpTask.findMany({
        where: {
          tenantId,
          status: {
            in: [
              FollowUpTaskStatus.OPEN,
              FollowUpTaskStatus.DRAFTED,
              FollowUpTaskStatus.WAITING_APPROVAL,
              FollowUpTaskStatus.APPROVED,
            ],
          },
          dueAt: { lt: new Date() },
        },
        select: { id: true, title: true, status: true, dueAt: true },
        orderBy: { dueAt: "asc" },
        take: 8,
      }),
    ]);

  return [
    ...listingsMissingDrive.map((listing) => ({
      id: `local:listing-drive:${listing.id}`,
      title: "Listing missing Drive folder",
      detail: `${listing.shortAddress || listing.address} is active but has no tenant-scoped Drive folder linked.`,
      severity: "warning" as const,
      subjectType: "Listing",
      subjectId: listing.id,
      source: "prisma:Listing",
      staleSince: listing.updatedAt.toISOString(),
    })),
    ...staleContacts.map((contact) => ({
      id: `local:contact-stale:${contact.id}`,
      title: "Contact follow-up is stale",
      detail: `${contactName(contact)} has no recent recorded touchpoint in REAOPS.`,
      severity: "warning" as const,
      subjectType: "Contact",
      subjectId: contact.id,
      source: "prisma:Contact",
      staleSince: contact.lastContactAt?.toISOString(),
    })),
    ...staleCachedContacts.map((contact) => ({
      id: `local:cached-contact-stale:${contact.id}`,
      title: "HubSpot contact follow-up is stale",
      detail: `${contactName(contact)} has no recent synced HubSpot contact date.`,
      severity: "info" as const,
      subjectType: "CachedContact",
      subjectId: contact.id,
      source: "prisma:CachedContact",
      staleSince: contact.lastContactDate?.toISOString(),
    })),
    ...oldApprovals.map((approval) => ({
      id: `local:approval-aging:${approval.id}`,
      title: "Approval is aging",
      detail: `${approval.draft?.subject ?? approval.task?.title ?? "Pending approval"} has been waiting since ${formatDate(approval.createdAt)}.`,
      severity: "warning" as const,
      subjectType: "Approval",
      subjectId: approval.id,
      source: "prisma:Approval",
      staleSince: approval.createdAt.toISOString(),
    })),
    ...openCompliance.map((review) => ({
      id: `local:compliance-open:${review.id}`,
      title: "Compliance item is open",
      detail: `${review.title} is ${review.status}${review.deadlineAt ? ` with deadline ${formatDate(review.deadlineAt)}` : ""}.`,
      severity: review.status === ComplianceReviewStatus.FLAGGED ? ("critical" as const) : ("warning" as const),
      subjectType: "ComplianceReview",
      subjectId: review.id,
      source: "prisma:ComplianceReview",
      staleSince: review.updatedAt.toISOString(),
    })),
    ...overdueTasks.map((task) => ({
      id: `local:task-overdue:${task.id}`,
      title: "Follow-up task is overdue",
      detail: `${task.title} is ${task.status} and was due ${formatDate(task.dueAt)}.`,
      severity: "warning" as const,
      subjectType: "FollowUpTask",
      subjectId: task.id,
      source: "prisma:FollowUpTask",
      staleSince: task.dueAt?.toISOString(),
    })),
  ].slice(0, 24);
}

function normalizeLastIngest(
  event:
    | {
        action: string;
        createdAt: Date;
        metadata: unknown;
      }
    | null
) {
  if (!event) return null;
  const metadata = objectFrom(event.metadata);
  return {
    at: event.createdAt,
    ok: event.action === "tenant_brain.ingest" && metadata.ok !== false,
    count: numberFrom(metadata.count),
    reason: stringFrom(metadata.reason),
    error: stringFrom(metadata.error),
  };
}

function tenantIdFromMemory(memory: TenantBrainMemory) {
  const metadata = objectFrom(memory.metadata);
  const scope = objectFrom(metadata.scope);
  return stringFrom(metadata.tenantId) ?? stringFrom(scope.tenantId) ?? tenantIdFromNamespace(metadata.namespace);
}

function tenantIdFromNamespace(value: unknown) {
  const namespace = stringFrom(value);
  if (!namespace?.startsWith("tenant:")) return null;
  return namespace.slice("tenant:".length) || null;
}

function citationsFromMemories(memories: TenantBrainMemory[]) {
  return memories
    .map((memory) => memory.source || [memory.subjectType, memory.subjectId].filter(Boolean).join(":") || memory.title)
    .filter(Boolean);
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

function objectFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function numberFrom(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringFrom(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unique(values: string[]) {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}
