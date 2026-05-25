import { createHash } from "crypto";
import {
  ApprovalMode,
  ChannelKind,
  MessageRisk,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

export const AGENT_ACTION_POLICY_VERSION = "2026-05-25.autonomy-v1";

export type AgentActionRisk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AgentReviewRequirement = "none" | "content_pass" | "human_approval";

export type AgentActionPolicy = {
  id: string;
  label: string;
  risk: AgentActionRisk;
  category: "read" | "write" | "outbound" | "admin" | "sync" | "workflow";
  requiredPermission: "tenant_member" | "channel_owner" | "broker_owner" | "platform_admin";
  reviewRequirement: AgentReviewRequirement;
  externalWrite: boolean;
  outbound: boolean;
  idempotent: boolean;
};

export type AgentActionPolicyDecision = {
  allowed: boolean;
  reasons: string[];
  policy: AgentActionPolicy;
  idempotencyKey: string;
  auditMetadata: Prisma.InputJsonValue;
};

export const AGENT_ACTION_POLICIES = {
  portfolio_summary: readPolicy("portfolio_summary", "Portfolio summary"),
  suggest_actions: readPolicy("suggest_actions", "Suggested actions"),
  report_daily_brief: readPolicy("report_daily_brief", "Daily brief report"),
  run_agent_loop: workflowPolicy("run_agent_loop", "Run agent loop", "MEDIUM"),

  listing_search: readPolicy("listing_search", "Search listings"),
  listing_get_details: readPolicy("listing_get_details", "Listing details"),

  marketing_create_launch_pack: writePolicy("marketing_create_launch_pack", "Create launch pack", "MEDIUM", "content_pass"),
  marketing_generate_pack: readPolicy("marketing_generate_pack", "Generate marketing pack"),
  marketing_save_to_drive: externalPolicy("marketing_save_to_drive", "Save marketing to Drive", "MEDIUM", "content_pass"),
  marketing_asset_create: writePolicy("marketing_asset_create", "Create marketing asset", "MEDIUM", "content_pass"),

  flyer_create: externalPolicy("flyer_create", "Create flyer assets", "MEDIUM", "content_pass"),
  flyer_email: outboundPolicy("flyer_email", "Email flyer", "MEDIUM", "content_pass"),

  zillow_scrape_profile: readPolicy("zillow_scrape_profile", "Scrape Zillow profile"),
  zillow_scrape_listing: readPolicy("zillow_scrape_listing", "Scrape Zillow listing"),
  zillow_sync_profile: workflowPolicy("zillow_sync_profile", "Sync Zillow profile", "MEDIUM"),

  calendar_list_events: readPolicy("calendar_list_events", "List calendar events"),
  calendar_create_event: externalPolicy("calendar_create_event", "Create calendar event", "MEDIUM", "none"),
  calendar_add_attendee: externalPolicy("calendar_add_attendee", "Add calendar attendee", "MEDIUM", "none"),

  followup_create_task: writePolicy("followup_create_task", "Create follow-up task", "LOW", "none"),
  followup_draft_message: writePolicy("followup_draft_message", "Draft follow-up message", "LOW", "content_pass"),
  followup_draft_email: writePolicy("followup_draft_email", "Draft email", "LOW", "content_pass"),
  followup_draft_text: writePolicy("followup_draft_text", "Draft text", "LOW", "content_pass"),
  followup_create_reminder: writePolicy("followup_create_reminder", "Create follow-up reminder", "LOW", "none"),

  buffer_list_profiles: readPolicy("buffer_list_profiles", "List Buffer profiles"),
  buffer_create_draft: externalPolicy("buffer_create_draft", "Create Buffer draft", "LOW", "content_pass"),

  drive_list_folders: readPolicy("drive_list_folders", "List Drive folders"),
  drive_list_files: readPolicy("drive_list_files", "List Drive files"),
  drive_get_file_info: readPolicy("drive_get_file_info", "Drive file info"),
  drive_move_file: externalPolicy("drive_move_file", "Move Drive file", "MEDIUM", "none"),
  drive_create_doc: externalPolicy("drive_create_doc", "Create Drive doc", "MEDIUM", "content_pass"),
  drive_search: readPolicy("drive_search", "Search Drive"),
  drive_get_photos: readPolicy("drive_get_photos", "Get Drive photos"),

  message_send: outboundPolicy("message_send", "Send message", "LOW", "content_pass"),
  compliance_review_create: writePolicy("compliance_review_create", "Create compliance review", "MEDIUM", "none"),
} satisfies Record<string, AgentActionPolicy>;

export type AgentActionId = keyof typeof AGENT_ACTION_POLICIES;

export function getAgentActionPolicy(actionId: string): AgentActionPolicy | null {
  return (AGENT_ACTION_POLICIES as Record<string, AgentActionPolicy>)[actionId] ?? null;
}

export function actionPolicySnapshot(actionId: string) {
  const policy = getAgentActionPolicy(actionId);
  return policy
    ? {
        id: policy.id,
        risk: policy.risk,
        reviewRequirement: policy.reviewRequirement,
        externalWrite: policy.externalWrite,
        outbound: policy.outbound,
        version: AGENT_ACTION_POLICY_VERSION,
      }
    : null;
}

export function assertAgentToolPolicies(toolNames: string[]) {
  const missing = toolNames.filter((name) => !getAgentActionPolicy(name));
  if (missing.length > 0) {
    throw new Error(`Missing agent action policy for tool(s): ${missing.join(", ")}`);
  }
}

export async function evaluateAutonomousAction(input: {
  prisma: PrismaClient;
  actor: { id: string; tenantId: string; role?: string | null };
  actionId: string;
  channel?: ChannelKind | null;
  recipient?: string | null;
  reviewStatus?: "PASS" | "BLOCK" | "NEEDS_HUMAN" | null;
  risk?: MessageRisk | AgentActionRisk | null;
  autoSend?: boolean;
  humanApproved?: boolean;
  idempotencyParts?: Array<string | number | null | undefined>;
  now?: Date;
}): Promise<AgentActionPolicyDecision> {
  const policy = getAgentActionPolicy(input.actionId);
  if (!policy) {
    const fallback = workflowPolicy(input.actionId, input.actionId, "CRITICAL");
    return decision(false, ["Action has no registered autonomy policy."], fallback, input);
  }

  const reasons: string[] = [];
  const [tenant, channelAccount, googleAccountCount] = await Promise.all([
    input.prisma.tenant.findUnique({
      where: { id: input.actor.tenantId },
      select: { isActive: true, defaultApprovalMode: true },
    }),
    input.channel
      ? input.prisma.channelAccount.findFirst({
          where: { tenantId: input.actor.tenantId, kind: input.channel },
          orderBy: { updatedAt: "desc" },
          select: { status: true, lastError: true },
        })
      : Promise.resolve(null),
    input.channel === ChannelKind.GMAIL && policy.outbound
      ? input.prisma.account.count({
          where: {
            userId: input.actor.id,
            provider: "google",
            refresh_token: { not: null },
          },
        })
      : Promise.resolve(1),
  ]);

  if (!tenant?.isActive) reasons.push("Tenant is inactive.");
  if (input.reviewStatus === "BLOCK") reasons.push("Content review returned BLOCK.");
  if (
    policy.reviewRequirement === "content_pass" &&
    input.reviewStatus &&
    input.reviewStatus !== "PASS" &&
    !(input.humanApproved && input.reviewStatus === "NEEDS_HUMAN")
  ) {
    reasons.push("Content requires a passing review or human approval before this action.");
  }
  if (policy.reviewRequirement === "human_approval" && !input.humanApproved) {
    reasons.push("Human approval is required before this action.");
  }
  if (policy.outbound && !validRecipient(input.recipient, input.channel ?? null)) {
    reasons.push("Recipient is missing or invalid for the outbound channel.");
  }
  if (policy.outbound && input.channel === ChannelKind.GMAIL && googleAccountCount === 0) {
    reasons.push("No active Gmail/Google sender token is available.");
  }
  if (policy.outbound && channelAccount && channelAccount.status && unhealthyChannelStatus(channelAccount.status)) {
    reasons.push(`Channel health is ${channelAccount.status}${channelAccount.lastError ? `: ${channelAccount.lastError}` : ""}.`);
  }
  if (policy.outbound && inQuietHours(input.now ?? new Date())) {
    reasons.push("Tenant autonomy quiet hours are active.");
  }

  if (input.autoSend) {
    const effectiveRisk = riskFrom(input.risk) ?? policy.risk;
    if (riskRank(effectiveRisk) > riskRank("LOW")) {
      reasons.push(`Auto-send is only allowed for LOW risk actions; this is ${effectiveRisk}.`);
    }
    if (
      tenant?.defaultApprovalMode !== ApprovalMode.AUTO_SEND_LOW_RISK &&
      tenant?.defaultApprovalMode !== ApprovalMode.AUTO_SEND_ALL
    ) {
      reasons.push("Tenant approval policy does not allow autonomous sending.");
    }
    if (policy.reviewRequirement === "human_approval") {
      reasons.push("This action always requires human approval.");
    }
  }

  return decision(reasons.length === 0, reasons, policy, input);
}

function decision(
  allowed: boolean,
  reasons: string[],
  policy: AgentActionPolicy,
  input: {
    actor: { id: string; tenantId: string; role?: string | null };
    actionId: string;
    channel?: ChannelKind | null;
    recipient?: string | null;
    reviewStatus?: string | null;
    risk?: MessageRisk | AgentActionRisk | null;
    autoSend?: boolean;
    humanApproved?: boolean;
    idempotencyParts?: Array<string | number | null | undefined>;
  }
): AgentActionPolicyDecision {
  const idempotencyKey = makeIdempotencyKey(input);
  return {
    allowed,
    reasons: allowed ? ["Action policy passed."] : reasons,
    policy,
    idempotencyKey,
    auditMetadata: {
      policyVersion: AGENT_ACTION_POLICY_VERSION,
      actionId: input.actionId,
      allowed,
      reasons: allowed ? ["Action policy passed."] : reasons,
      risk: input.risk ?? policy.risk,
      reviewStatus: input.reviewStatus ?? null,
      channel: input.channel ?? null,
      autoSend: input.autoSend ?? false,
      humanApproved: input.humanApproved ?? false,
      idempotencyKey,
    },
  };
}

function makeIdempotencyKey(input: {
  actor: { tenantId: string; id: string };
  actionId: string;
  channel?: ChannelKind | null;
  recipient?: string | null;
  idempotencyParts?: Array<string | number | null | undefined>;
}) {
  const parts = [
    AGENT_ACTION_POLICY_VERSION,
    input.actor.tenantId,
    input.actor.id,
    input.actionId,
    input.channel ?? "none",
    normalizeRecipient(input.recipient),
    ...(input.idempotencyParts ?? []).map((part) => String(part ?? "none")),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

function readPolicy(id: string, label: string): AgentActionPolicy {
  return basePolicy(id, label, "LOW", "read", "none", false, false, true);
}

function writePolicy(
  id: string,
  label: string,
  risk: AgentActionRisk,
  reviewRequirement: AgentReviewRequirement
): AgentActionPolicy {
  return basePolicy(id, label, risk, "write", reviewRequirement, false, false, true);
}

function workflowPolicy(id: string, label: string, risk: AgentActionRisk): AgentActionPolicy {
  return basePolicy(id, label, risk, "workflow", "none", false, false, false);
}

function externalPolicy(
  id: string,
  label: string,
  risk: AgentActionRisk,
  reviewRequirement: AgentReviewRequirement
): AgentActionPolicy {
  return basePolicy(id, label, risk, "write", reviewRequirement, true, false, false);
}

function outboundPolicy(
  id: string,
  label: string,
  risk: AgentActionRisk,
  reviewRequirement: AgentReviewRequirement
): AgentActionPolicy {
  return basePolicy(id, label, risk, "outbound", reviewRequirement, true, true, false);
}

function basePolicy(
  id: string,
  label: string,
  risk: AgentActionRisk,
  category: AgentActionPolicy["category"],
  reviewRequirement: AgentReviewRequirement,
  externalWrite: boolean,
  outbound: boolean,
  idempotent: boolean
): AgentActionPolicy {
  return {
    id,
    label,
    risk,
    category,
    requiredPermission: "tenant_member",
    reviewRequirement,
    externalWrite,
    outbound,
    idempotent,
  };
}

function riskFrom(risk: MessageRisk | AgentActionRisk | null | undefined): AgentActionRisk | null {
  if (!risk) return null;
  const value = String(risk);
  if (value === "LOW") return "LOW";
  if (value === "MEDIUM") return "MEDIUM";
  if (value === "HIGH") return "HIGH";
  if (value === "CRITICAL") return "CRITICAL";
  return null;
}

function riskRank(risk: AgentActionRisk) {
  if (risk === "CRITICAL") return 3;
  if (risk === "HIGH") return 2;
  if (risk === "MEDIUM") return 1;
  return 0;
}

function validRecipient(recipient: string | null | undefined, channel: ChannelKind | null) {
  const value = recipient?.trim();
  if (!value) return false;
  if (channel === ChannelKind.GMAIL) return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
  if (channel === ChannelKind.BLUEBUBBLES || channel === ChannelKind.SMS || channel === ChannelKind.WHATSAPP) {
    return /^\+?[0-9().\-\s]{7,}$/.test(value);
  }
  return true;
}

function normalizeRecipient(recipient: string | null | undefined) {
  return recipient?.trim().toLowerCase() ?? "none";
}

function unhealthyChannelStatus(status: string) {
  return ["unhealthy", "error", "failed", "disabled", "revoked"].includes(status.toLowerCase());
}

function inQuietHours(now: Date) {
  const raw = process.env.AUTONOMY_QUIET_HOURS?.trim();
  if (!raw) return false;
  const match = raw.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!match) return false;
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}
