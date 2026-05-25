import {
  ApprovalMode,
  ApprovalStatus,
  ChannelKind,
  ComplianceReviewStatus,
  FollowUpTaskStatus,
  MarketingAssetStatus,
  MarketingAssetType,
  MessageDraftStatus,
  MessageRisk,
  TouchpointDirection,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { generateText } from "ai";
import { resolveLanguageModel } from "@/lib/ai-chat";
import { evaluateAutonomousAction } from "@/lib/agent-action-policy";
import { sendChannelMessage } from "@/lib/channels";
import {
  extractReviewStatus,
  mergeMetadataWithReview,
  reviewContent,
  reviewToJson,
  type ContentReviewResult,
  type ContentReviewKind,
} from "@/lib/content-review";
import { getGoogleAccessTokenForUser } from "@/lib/google-account-token";
import { syncPendingTouchpointsToHubSpot, syncTouchpointToHubSpot } from "@/lib/hubspot";
import { ensureOpsDefaults } from "@/lib/ops/defaults";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { getTenantBrain } from "@/lib/tenant-brain";

export type Actor = {
  id: string;
  tenantId: string;
  role?: string | null;
};

export function contactDisplayName(contact: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}): string {
  return (
    [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
    contact.email ||
    contact.phone ||
    "Contact"
  );
}

export function classifyMessageRisk(text: string): MessageRisk {
  const lower = text.toLowerCase();
  const highRisk = [
    "offer",
    "counteroffer",
    "earnest money",
    "inspection",
    "appraisal",
    "financing contingency",
    "terminate",
    "breach",
    "lawsuit",
    "legal",
    "attorney",
    "price reduction",
    "lower the price",
    "contract",
    "deadline",
    "disclosure",
  ];
  if (highRisk.some((term) => lower.includes(term))) return MessageRisk.HIGH;

  const mediumRisk = ["seller", "buyer agency", "commission", "repair", "concession", "vip"];
  if (mediumRisk.some((term) => lower.includes(term))) return MessageRisk.MEDIUM;

  return MessageRisk.LOW;
}

export function requiresApproval(mode: ApprovalMode, risk: MessageRisk): boolean {
  if (mode === ApprovalMode.DRAFT_ONLY || mode === ApprovalMode.APPROVAL_REQUIRED) return true;
  if (mode === ApprovalMode.AUTO_SEND_ALL) return false;
  return risk !== MessageRisk.LOW;
}

export async function createContact(input: {
  prisma?: PrismaClient;
  actor: Actor;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  leadSourceId?: string | null;
  ownerUserId?: string | null;
  notes?: string | null;
}) {
  const prisma = input.prisma ?? defaultPrisma;
  await ensureOpsDefaults(prisma, input.actor.tenantId);
  const contact = await prisma.contact.create({
    data: {
      tenantId: input.actor.tenantId,
      firstName: input.firstName || null,
      lastName: input.lastName || null,
      email: input.email || null,
      phone: input.phone || null,
      leadSourceId: input.leadSourceId || null,
      ownerUserId: input.ownerUserId || input.actor.id,
      notes: input.notes || null,
      lastContactAt: null,
    },
  });
  await logAudit(prisma, input.actor, "contact.create", "Contact", contact.id, {
    name: contactDisplayName(contact),
  });
  return contact;
}

export async function createFollowUpTask(input: {
  prisma?: PrismaClient;
  actor: Actor;
  contactId?: string | null;
  listingId?: string | null;
  opportunityId?: string | null;
  title: string;
  context?: string | null;
  source?: string | null;
  dueAt?: Date | null;
  risk?: MessageRisk;
  priority?: number;
  ownerUserId?: string | null;
}) {
  const prisma = input.prisma ?? defaultPrisma;
  await ensureOpsDefaults(prisma, input.actor.tenantId);
  const risk = input.risk ?? classifyMessageRisk(`${input.title}\n${input.context ?? ""}`);
  const task = await prisma.followUpTask.create({
    data: {
      tenantId: input.actor.tenantId,
      contactId: input.contactId || null,
      listingId: input.listingId || null,
      opportunityId: input.opportunityId || null,
      title: input.title,
      context: input.context || null,
      source: input.source || "manual",
      dueAt: input.dueAt || null,
      risk,
      priority: input.priority ?? 3,
      ownerUserId: input.ownerUserId || input.actor.id,
      createdByUserId: input.actor.id,
    },
  });
  await logAudit(prisma, input.actor, "followup.create", "FollowUpTask", task.id, {
    title: task.title,
    risk: task.risk,
  });
  return task;
}

export async function draftMessage(input: {
  prisma?: PrismaClient;
  actor: Actor;
  taskId?: string | null;
  contactId?: string | null;
  channel?: ChannelKind;
  subject?: string | null;
  body?: string | null;
  context?: string | null;
  recipient?: string | null;
  autoSend?: boolean;
}) {
  const prisma = input.prisma ?? defaultPrisma;
  await ensureOpsDefaults(prisma, input.actor.tenantId);

  const tenant = await prisma.tenant.findUnique({
    where: { id: input.actor.tenantId },
    select: { defaultApprovalMode: true, defaultTone: true },
  });
  const channel = input.channel ?? ChannelKind.GMAIL;
  const task = input.taskId
    ? await prisma.followUpTask.findFirst({
        where: { id: input.taskId, tenantId: input.actor.tenantId },
        include: { contact: true },
      })
    : null;
  const contact = input.contactId
    ? await prisma.contact.findFirst({ where: { id: input.contactId, tenantId: input.actor.tenantId } })
    : task?.contact ?? null;
  const contactName = contact ? contactDisplayName(contact) : "there";
  const body =
    input.body ??
    (await generateFollowUpCopy({
      contactName,
      context: input.context ?? task?.context ?? task?.title ?? "Follow up with this contact.",
      tone: tenant?.defaultTone ?? "Warm, concise, professional.",
      channel,
    }));
  const risk = classifyMessageRisk(`${input.subject ?? ""}\n${body}\n${task?.context ?? ""}`);
  const mode = tenant?.defaultApprovalMode ?? ApprovalMode.AUTO_SEND_LOW_RISK;
  const review = await reviewContent({
    prisma,
    tenantId: input.actor.tenantId,
    actorId: input.actor.id,
    kind: contentReviewKindForChannel(channel),
    subject: input.subject || defaultSubject(task?.title),
    content: body,
  });
  const needsApproval = requiresApproval(mode, risk) || review.status !== "PASS";
  const recipient = input.recipient ?? defaultRecipient(contact, channel);
  const identity = await resolveSendingIdentity(prisma, input.actor.tenantId, channel);

  const draft = await prisma.messageDraft.create({
    data: {
      tenantId: input.actor.tenantId,
      taskId: task?.id ?? input.taskId ?? null,
      contactId: contact?.id ?? input.contactId ?? null,
      channel,
      subject: input.subject || defaultSubject(task?.title),
      body,
      recipient,
      risk,
      requiresApproval: needsApproval,
      status: needsApproval ? MessageDraftStatus.WAITING_APPROVAL : MessageDraftStatus.APPROVED,
      sendingIdentityId: identity?.id ?? null,
      createdByUserId: input.actor.id,
      metadata: mergeMetadataWithReview(null, review),
    },
  });

  if (needsApproval) {
    await prisma.approval.create({
      data: {
        tenantId: input.actor.tenantId,
        draftId: draft.id,
        taskId: task?.id ?? null,
        requestedForId: task?.ownerUserId ?? contact?.ownerUserId ?? input.actor.id,
      },
    });
  }
  if (review.status !== "PASS") {
    await createContentComplianceReview({
      prisma,
      actor: input.actor,
      title: `Review gated ${channel} draft: ${draft.subject ?? "Message"}`,
      summary: `Content review returned ${review.status}. ${review.reasons.join(" ")}`,
      draftId: draft.id,
      contactId: contact?.id ?? input.contactId ?? null,
      taskId: task?.id ?? input.taskId ?? null,
      review,
    });
  }

  if (task) {
    await prisma.followUpTask.update({
      where: { id: task.id },
      data: {
        status: needsApproval ? FollowUpTaskStatus.WAITING_APPROVAL : FollowUpTaskStatus.APPROVED,
      },
    });
  }

  await logAudit(prisma, input.actor, "message.draft", "MessageDraft", draft.id, {
    channel,
    risk,
    requiresApproval: needsApproval,
    contentReviewStatus: review.status,
  });

  if (!needsApproval && input.autoSend) {
    const decision = await evaluateAutonomousAction({
      prisma,
      actor: input.actor,
      actionId: "message_send",
      channel,
      recipient,
      reviewStatus: review.status,
      risk,
      autoSend: true,
      idempotencyParts: [draft.id],
    });
    await logAudit(prisma, input.actor, "action.policy.evaluate", "MessageDraft", draft.id, decision.auditMetadata);
    if (decision.allowed) {
      return sendApprovedMessage({ prisma, actor: input.actor, draftId: draft.id });
    }
    await logAudit(prisma, input.actor, "message.autosend_skipped", "MessageDraft", draft.id, decision.auditMetadata);
  }

  return draft;
}

export async function approveDraft(input: {
  prisma?: PrismaClient;
  actor: Actor;
  draftId: string;
  approve?: boolean;
  reason?: string | null;
}) {
  const prisma = input.prisma ?? defaultPrisma;
  const draft = await prisma.messageDraft.findFirst({
    where: { id: input.draftId, tenantId: input.actor.tenantId },
  });
  if (!draft) throw new Error("Draft not found.");
  if ((input.approve ?? true) && extractReviewStatus(draft.metadata) === "BLOCK") {
    throw new Error("This draft is blocked by content review. Revise it before approval.");
  }

  const approved = input.approve ?? true;
  const status = approved ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
  await prisma.approval.updateMany({
    where: { draftId: draft.id, tenantId: input.actor.tenantId, status: ApprovalStatus.PENDING },
    data: {
      status,
      decidedById: input.actor.id,
      decidedAt: new Date(),
      reason: input.reason || null,
    },
  });

  const updated = await prisma.messageDraft.update({
    where: { id: draft.id },
    data: {
      status: approved ? MessageDraftStatus.APPROVED : MessageDraftStatus.SKIPPED,
      approvedAt: approved ? new Date() : null,
    },
  });

  if (draft.taskId) {
    await prisma.followUpTask.update({
      where: { id: draft.taskId },
      data: { status: approved ? FollowUpTaskStatus.APPROVED : FollowUpTaskStatus.SKIPPED },
    });
  }

  await logAudit(prisma, input.actor, approved ? "message.approve" : "message.reject", "MessageDraft", draft.id);
  await captureTenantBrainDecision({
    prisma,
    actor: input.actor,
    subjectType: "MessageDraft",
    subjectId: draft.id,
    decision: approved ? "approved" : "rejected",
    rationale: input.reason ?? null,
  });
  return updated;
}

export async function reviseDraft(input: {
  prisma?: PrismaClient;
  actor: Actor;
  draftId: string;
  subject?: string | null;
  body: string;
  recipient?: string | null;
}) {
  const prisma = input.prisma ?? defaultPrisma;
  const draft = await prisma.messageDraft.findFirst({
    where: { id: input.draftId, tenantId: input.actor.tenantId },
    include: { task: { include: { listing: true } }, contact: true },
  });
  if (!draft) throw new Error("Draft not found.");
  if (
    draft.status === MessageDraftStatus.SENT ||
    draft.status === MessageDraftStatus.FAILED ||
    draft.status === MessageDraftStatus.SKIPPED
  ) {
    throw new Error("Only active drafts can be revised.");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: input.actor.tenantId },
    select: { defaultApprovalMode: true },
  });
  const subject = input.subject ?? draft.subject;
  const body = input.body.trim();
  if (!body) throw new Error("Draft body is required.");
  const recipient = input.recipient ?? draft.recipient;
  const risk = classifyMessageRisk(`${subject ?? ""}\n${body}\n${draft.task?.context ?? ""}`);
  const mode = tenant?.defaultApprovalMode ?? ApprovalMode.AUTO_SEND_LOW_RISK;
  const review = await reviewContent({
    prisma,
    tenantId: input.actor.tenantId,
    actorId: input.actor.id,
    kind: contentReviewKindForChannel(draft.channel),
    subject,
    content: body,
    facts: draft.task?.listing ? listingFactsForReview(draft.task.listing) : null,
  });
  const needsApproval = requiresApproval(mode, risk) || review.status !== "PASS";

  await prisma.approval.updateMany({
    where: {
      tenantId: input.actor.tenantId,
      draftId: draft.id,
      status: ApprovalStatus.PENDING,
    },
    data: {
      status: ApprovalStatus.REJECTED,
      decidedById: input.actor.id,
      decidedAt: new Date(),
      reason: "Superseded by a revised draft.",
    },
  });

  const updated = await prisma.messageDraft.update({
    where: { id: draft.id },
    data: {
      subject,
      body,
      recipient,
      risk,
      requiresApproval: needsApproval,
      status: needsApproval ? MessageDraftStatus.WAITING_APPROVAL : MessageDraftStatus.APPROVED,
      approvedAt: null,
      metadata: mergeMetadataWithReview(
        appendDraftRevisionMetadata(draft.metadata as Prisma.InputJsonValue, {
          revisedAt: new Date().toISOString(),
          previousSubject: draft.subject,
          previousBody: draft.body,
          previousRecipient: draft.recipient,
          previousReviewStatus: extractReviewStatus(draft.metadata),
        }),
        review
      ),
    },
  });

  if (needsApproval) {
    await prisma.approval.create({
      data: {
        tenantId: input.actor.tenantId,
        draftId: draft.id,
        taskId: draft.taskId,
        requestedForId: draft.task?.ownerUserId ?? draft.contact?.ownerUserId ?? input.actor.id,
      },
    });
  }
  if (review.status !== "PASS") {
    await createContentComplianceReview({
      prisma,
      actor: input.actor,
      title: `Review gated revised ${draft.channel} draft: ${subject ?? "Message"}`,
      summary: `Content review returned ${review.status}. ${review.reasons.join(" ")}`,
      draftId: draft.id,
      contactId: draft.contactId,
      taskId: draft.taskId,
      review,
    });
  }

  if (draft.taskId) {
    await prisma.followUpTask.update({
      where: { id: draft.taskId },
      data: {
        status: needsApproval ? FollowUpTaskStatus.WAITING_APPROVAL : FollowUpTaskStatus.APPROVED,
        risk,
      },
    });
  }

  await logAudit(prisma, input.actor, "message.revise", "MessageDraft", draft.id, {
    risk,
    requiresApproval: needsApproval,
    contentReviewStatus: review.status,
  });
  return updated;
}

export async function sendApprovedMessage(input: {
  prisma?: PrismaClient;
  actor: Actor;
  draftId: string;
}) {
  const prisma = input.prisma ?? defaultPrisma;
  const draft = await prisma.messageDraft.findFirst({
    where: { id: input.draftId, tenantId: input.actor.tenantId },
    include: { contact: true, task: { include: { listing: true } } },
  });
  if (!draft) throw new Error("Draft not found.");
  let reviewStatus = extractReviewStatus(draft.metadata);
  if (!reviewStatus) {
    const review = await reviewContent({
      prisma,
      tenantId: input.actor.tenantId,
      actorId: input.actor.id,
      kind: contentReviewKindForChannel(draft.channel),
      subject: draft.subject,
      content: draft.body,
      facts: draft.task?.listing ? listingFactsForReview(draft.task.listing) : null,
    });
    reviewStatus = review.status;
    await prisma.messageDraft.update({
      where: { id: draft.id },
      data: {
        metadata: mergeMetadataWithReview(draft.metadata as Prisma.InputJsonValue, review),
      },
    });
    if (review.status !== "PASS") {
      await createContentComplianceReview({
        prisma,
        actor: input.actor,
        title: `Review gated send: ${draft.subject ?? "Message"}`,
        summary: `Content review returned ${review.status}. ${review.reasons.join(" ")}`,
        draftId: draft.id,
        contactId: draft.contactId,
        taskId: draft.taskId,
        review,
      });
    }
  }
  if (reviewStatus === "BLOCK") {
    throw new Error("This draft is blocked by content review. Revise it before sending.");
  }
  if (draft.requiresApproval && draft.status !== MessageDraftStatus.APPROVED) {
    throw new Error("Draft requires approval before sending.");
  }

  const policyDecision = await evaluateAutonomousAction({
    prisma,
    actor: input.actor,
    actionId: "message_send",
    channel: draft.channel,
    recipient: draft.recipient || defaultRecipient(draft.contact, draft.channel) || "",
    reviewStatus,
    risk: draft.risk,
    autoSend: false,
    humanApproved: draft.status === MessageDraftStatus.APPROVED && draft.requiresApproval,
    idempotencyParts: [draft.id],
  });
  await logAudit(prisma, input.actor, "action.policy.evaluate", "MessageDraft", draft.id, policyDecision.auditMetadata);
  if (!policyDecision.allowed) {
    throw new Error(`Action policy blocked send: ${policyDecision.reasons.join(" ")}`);
  }

  const accessToken =
    draft.channel === ChannelKind.GMAIL
      ? await getGoogleAccessTokenForUser(input.actor.id)
      : null;
  const result = await sendChannelMessage({
    prisma,
    tenantId: input.actor.tenantId,
    channel: draft.channel,
    recipient: draft.recipient || defaultRecipient(draft.contact, draft.channel) || "",
    subject: draft.subject,
    body: draft.body,
    accessToken,
  });

  if (!result.ok) {
    await prisma.messageDraft.update({
      where: { id: draft.id },
      data: { status: MessageDraftStatus.FAILED },
    });
    if (draft.taskId) {
      await prisma.followUpTask.update({
        where: { id: draft.taskId },
        data: { status: FollowUpTaskStatus.FAILED, lastError: result.error },
      });
    }
    throw new Error(result.error ?? "Send failed.");
  }

  const now = new Date();
  const sent = await prisma.messageDraft.update({
    where: { id: draft.id },
    data: {
      status: MessageDraftStatus.SENT,
      sentAt: now,
      externalMessageId: result.externalId,
    },
  });

  const touchpoint = await logTouchpoint({
    prisma,
    actor: input.actor,
    contactId: draft.contactId,
    taskId: draft.taskId,
    draftId: draft.id,
    channel: draft.channel,
    direction: TouchpointDirection.OUTBOUND,
    subject: draft.subject,
    body: draft.body,
    externalId: result.externalId ?? null,
    occurredAt: now,
  });
  try {
    await syncTouchpointToHubSpot({
      prisma,
      tenantId: input.actor.tenantId,
      touchpointId: touchpoint.id,
    });
  } catch (error) {
    await logAudit(prisma, input.actor, "hubspot.touchpoint_sync_failed", "Touchpoint", touchpoint.id, {
      error: error instanceof Error ? error.message : "HubSpot touchpoint sync failed.",
    });
  }

  if (draft.taskId) {
    await prisma.followUpTask.update({
      where: { id: draft.taskId },
      data: { status: FollowUpTaskStatus.SENT, completedAt: now, lastError: null },
    });
  }

  await logAudit(prisma, input.actor, "message.send", "MessageDraft", draft.id, {
    channel: draft.channel,
    externalId: result.externalId,
  });
  return sent;
}

export async function logTouchpoint(input: {
  prisma?: PrismaClient;
  actor: Actor;
  contactId?: string | null;
  listingId?: string | null;
  opportunityId?: string | null;
  taskId?: string | null;
  draftId?: string | null;
  channel?: ChannelKind | null;
  direction?: TouchpointDirection;
  subject?: string | null;
  body: string;
  externalId?: string | null;
  occurredAt?: Date;
  metadata?: Prisma.InputJsonValue;
}) {
  const prisma = input.prisma ?? defaultPrisma;
  const touchpoint = await prisma.touchpoint.create({
    data: {
      tenantId: input.actor.tenantId,
      contactId: input.contactId || null,
      listingId: input.listingId || null,
      opportunityId: input.opportunityId || null,
      followUpTaskId: input.taskId || null,
      messageDraftId: input.draftId || null,
      createdByUserId: input.actor.id,
      channel: input.channel || null,
      direction: input.direction ?? TouchpointDirection.INTERNAL,
      subject: input.subject || null,
      body: input.body,
      externalId: input.externalId || null,
      occurredAt: input.occurredAt ?? new Date(),
      metadata: input.metadata,
    },
  });
  if (input.contactId) {
    await prisma.contact.update({
      where: { id: input.contactId },
      data: { lastContactAt: input.occurredAt ?? new Date() },
    });
  }
  return touchpoint;
}

export async function generateMarketingAsset(input: {
  prisma?: PrismaClient;
  actor: Actor;
  listingId?: string | null;
  contactId?: string | null;
  type: MarketingAssetType;
  title: string;
  content?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  const prisma = input.prisma ?? defaultPrisma;
  const review = input.content
    ? await reviewContent({
        prisma,
        tenantId: input.actor.tenantId,
        actorId: input.actor.id,
        kind: contentReviewKindForAsset(input.type),
        title: input.title,
        content: input.content,
        facts: input.listingId ? await marketingAssetListingFacts(prisma, input.actor.tenantId, input.listingId) : null,
      })
    : null;
  const asset = await prisma.marketingAsset.create({
    data: {
      tenantId: input.actor.tenantId,
      listingId: input.listingId || null,
      contactId: input.contactId || null,
      type: input.type,
      title: input.title,
      content: input.content || null,
      metadata: review ? mergeMetadataWithReview(input.metadata, review) : input.metadata,
      status: review && review.status !== "PASS" ? MarketingAssetStatus.DRAFT : MarketingAssetStatus.GENERATED,
      createdByUserId: input.actor.id,
    },
  });
  if (review && review.status !== "PASS") {
    await createContentComplianceReview({
      prisma,
      actor: input.actor,
      title: `Review gated marketing asset: ${input.title}`,
      summary: `Content review returned ${review.status}. ${review.reasons.join(" ")}`,
      listingId: input.listingId,
      contactId: input.contactId,
      marketingAssetId: asset.id,
      review,
    });
  }
  await logAudit(prisma, input.actor, "marketing.asset.create", "MarketingAsset", asset.id, {
    type: input.type,
    contentReviewStatus: review?.status ?? null,
  });
  return asset;
}

export async function createComplianceReview(input: {
  prisma?: PrismaClient;
  actor: Actor;
  title: string;
  summary?: string | null;
  contactId?: string | null;
  listingId?: string | null;
  opportunityId?: string | null;
  sopTemplateId?: string | null;
  deadlineAt?: Date | null;
  flags?: Prisma.InputJsonValue;
}) {
  const prisma = input.prisma ?? defaultPrisma;
  await ensureOpsDefaults(prisma, input.actor.tenantId);
  const review = await prisma.complianceReview.create({
    data: {
      tenantId: input.actor.tenantId,
      title: input.title,
      summary: input.summary || null,
      contactId: input.contactId || null,
      listingId: input.listingId || null,
      opportunityId: input.opportunityId || null,
      sopTemplateId: input.sopTemplateId || null,
      deadlineAt: input.deadlineAt || null,
      flags: input.flags,
      status: input.flags ? ComplianceReviewStatus.FLAGGED : ComplianceReviewStatus.OPEN,
    },
  });
  await logAudit(prisma, input.actor, "compliance.review.create", "ComplianceReview", review.id);
  return review;
}

export async function scheduleReminder(input: {
  prisma?: PrismaClient;
  actor: Actor;
  contactId?: string | null;
  title: string;
  context?: string | null;
  dueAt: Date;
}) {
  return createFollowUpTask({
    prisma: input.prisma,
    actor: input.actor,
    contactId: input.contactId,
    title: input.title,
    context: input.context,
    dueAt: input.dueAt,
    source: "reminder",
  });
}

export async function buildOpsCommandCenter(prisma: PrismaClient, tenantId: string) {
  await ensureOpsDefaults(prisma, tenantId);
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - 14 * 86_400_000);
  const [openTasks, approvals, staleContacts, drafts, assets, compliance] = await Promise.all([
    prisma.followUpTask.findMany({
      where: {
        tenantId,
        status: { in: [FollowUpTaskStatus.OPEN, FollowUpTaskStatus.DRAFTED, FollowUpTaskStatus.WAITING_APPROVAL] },
      },
      include: { contact: true, drafts: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 12,
    }),
    prisma.approval.findMany({
      where: { tenantId, status: ApprovalStatus.PENDING },
      include: { draft: { include: { contact: true } }, task: true },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    prisma.contact.findMany({
      where: {
        tenantId,
        OR: [{ lastContactAt: null }, { lastContactAt: { lt: staleCutoff } }],
      },
      include: { leadSource: true },
      orderBy: [{ isVip: "desc" }, { lastContactAt: "asc" }],
      take: 12,
    }),
    prisma.messageDraft.count({ where: { tenantId, status: MessageDraftStatus.WAITING_APPROVAL } }),
    prisma.marketingAsset.findMany({
      where: { tenantId },
      include: { listing: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.complianceReview.findMany({
      where: { tenantId, status: { in: [ComplianceReviewStatus.OPEN, ComplianceReviewStatus.FLAGGED, ComplianceReviewStatus.NEEDS_HUMAN] } },
      orderBy: [{ deadlineAt: "asc" }, { createdAt: "desc" }],
      take: 8,
    }),
  ]);

  return {
    openTasks,
    approvals,
    staleContacts,
    waitingDraftCount: drafts,
    marketingAssets: assets,
    complianceReviews: compliance,
  };
}

export async function syncToHubSpot(input: {
  prisma?: PrismaClient;
  actor: Actor;
  summary?: Prisma.InputJsonValue;
}) {
  const prisma = input.prisma ?? defaultPrisma;
  const result = await syncPendingTouchpointsToHubSpot({
    prisma,
    tenantId: input.actor.tenantId,
    actorId: input.actor.id,
  });
  await logAudit(prisma, input.actor, "hubspot.sync.outbound_requested", undefined, undefined, {
    requestedSummary: input.summary ?? null,
    result,
  });
  return result;
}

async function generateFollowUpCopy(input: {
  contactName: string;
  context: string;
  tone: string;
  channel: ChannelKind;
}): Promise<string> {
  const model = resolveLanguageModel();
  if (!model) {
    return `Hi ${input.contactName},\n\nI wanted to follow up on ${input.context}. Let me know if you have any questions or would like to talk through next steps.\n\nBest,`;
  }

  const result = await generateText({
    model,
    system: `You write concise real estate follow-up messages. Tone: ${input.tone}. Avoid fair-housing violations. Do not make legal claims. ${
      input.channel === ChannelKind.GMAIL ? "Write as an email body." : "Write as a short message."
    }`,
    prompt: `Recipient: ${input.contactName}\nContext: ${input.context}`,
  });
  return result.text.trim();
}

function defaultSubject(title?: string | null): string {
  return title ? `Follow-up: ${title}` : "Quick follow-up";
}

function defaultRecipient(
  contact: { email?: string | null; phone?: string | null } | null,
  channel: ChannelKind
): string | null {
  if (!contact) return null;
  if (channel === ChannelKind.GMAIL) return contact.email ?? null;
  return contact.phone ?? contact.email ?? null;
}

async function resolveSendingIdentity(
  prisma: PrismaClient,
  tenantId: string,
  channel: ChannelKind
) {
  return prisma.sendingIdentity.findFirst({
    where: { tenantId, channel, isDefault: true },
    orderBy: { updatedAt: "desc" },
  });
}

function contentReviewKindForChannel(channel: ChannelKind): ContentReviewKind {
  if (channel === ChannelKind.GMAIL) return "EMAIL";
  return "TEXT";
}

function contentReviewKindForAsset(type: MarketingAssetType): ContentReviewKind {
  if (type === MarketingAssetType.FLYER) return "FLYER";
  if (type === MarketingAssetType.MLS_COPY) return "MLS_COPY";
  if (type === MarketingAssetType.EMAIL_COPY) return "EMAIL";
  if (type === MarketingAssetType.SOCIAL_COPY || type === MarketingAssetType.SOCIAL_IMAGE) {
    return "SOCIAL_POST";
  }
  return "MARKETING_ASSET";
}

function listingFactsForReview(listing: {
  address?: string | null;
  priceDisplay?: string | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  status?: string | null;
  features?: string | null;
}) {
  return {
    address: listing.address ?? null,
    priceDisplay: listing.priceDisplay ?? null,
    beds: listing.beds ?? null,
    baths: listing.baths ?? null,
    sqft: listing.sqft ?? null,
    status: listing.status ?? null,
    features: listing.features ?? null,
  };
}

function appendDraftRevisionMetadata(
  metadata: Prisma.InputJsonValue | null | undefined,
  revision: Prisma.InputJsonValue
): Prisma.InputJsonValue {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const revisions = Array.isArray(base.revisions) ? base.revisions : [];
  return {
    ...base,
    revisions: [...revisions, revision].slice(-5),
  };
}

async function marketingAssetListingFacts(
  prisma: PrismaClient,
  tenantId: string,
  listingId: string
) {
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, tenantId },
    select: {
      address: true,
      priceDisplay: true,
      beds: true,
      baths: true,
      sqft: true,
      status: true,
      features: true,
    },
  });
  return listing ? listingFactsForReview(listing) : null;
}

async function createContentComplianceReview(input: {
  prisma: PrismaClient;
  actor: Actor;
  title: string;
  summary: string;
  draftId?: string | null;
  taskId?: string | null;
  contactId?: string | null;
  listingId?: string | null;
  marketingAssetId?: string | null;
  review: ContentReviewResult;
}) {
  return createComplianceReview({
    prisma: input.prisma,
    actor: input.actor,
    title: input.title,
    summary: input.summary,
    contactId: input.contactId,
    listingId: input.listingId,
    flags: {
      source: "content_review",
      draftId: input.draftId ?? null,
      taskId: input.taskId ?? null,
      marketingAssetId: input.marketingAssetId ?? null,
      review: reviewToJson(input.review),
    },
  });
}

async function captureTenantBrainDecision(input: {
  prisma: PrismaClient;
  actor: Actor;
  subjectType: string;
  subjectId: string;
  decision: string;
  rationale?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  try {
    await getTenantBrain().captureDecision({
      tenantId: input.actor.tenantId,
      userId: input.actor.id,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      decision: input.decision,
      rationale: input.rationale ?? null,
      metadata: input.metadata,
    });
  } catch (e) {
    await input.prisma.auditEvent.create({
      data: {
        tenantId: input.actor.tenantId,
        userId: input.actor.id,
        action: "tenant_brain.capture_decision_failed",
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        metadata: { error: e instanceof Error ? e.message : "Tenant brain decision capture failed." },
      },
    });
  }
}

async function logAudit(
  prisma: PrismaClient,
  actor: Actor,
  action: string,
  subjectType?: string,
  subjectId?: string,
  metadata?: Prisma.InputJsonValue
) {
  return prisma.auditEvent.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.id,
      action,
      subjectType,
      subjectId,
      metadata,
    },
  });
}
