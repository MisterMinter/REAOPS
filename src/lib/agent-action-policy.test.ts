import test from "node:test";
import assert from "node:assert/strict";
import { ApprovalMode, ChannelKind, MessageRisk } from "@prisma/client";
import {
  AGENT_ACTION_POLICIES,
  assertAgentToolPolicies,
  evaluateAutonomousAction,
} from "@/lib/agent-action-policy";

const TOOL_NAMES = [
  "portfolio_summary",
  "suggest_actions",
  "report_daily_brief",
  "run_agent_loop",
  "listing_search",
  "listing_get_details",
  "marketing_create_launch_pack",
  "marketing_generate_pack",
  "marketing_save_to_drive",
  "flyer_create",
  "flyer_email",
  "zillow_scrape_profile",
  "zillow_scrape_listing",
  "zillow_sync_profile",
  "calendar_list_events",
  "calendar_create_event",
  "calendar_add_attendee",
  "followup_create_task",
  "followup_draft_message",
  "followup_draft_email",
  "followup_draft_text",
  "followup_create_reminder",
  "buffer_list_profiles",
  "buffer_create_draft",
  "drive_list_folders",
  "drive_list_files",
  "drive_get_file_info",
  "drive_move_file",
  "drive_create_doc",
  "drive_search",
  "drive_get_photos",
];

const prisma = {
  tenant: {
    findUnique: async () => ({ isActive: true, defaultApprovalMode: ApprovalMode.AUTO_SEND_LOW_RISK }),
  },
  channelAccount: {
    findFirst: async () => null,
  },
  account: {
    count: async () => 1,
  },
};

test("all agent tools have action policies", () => {
  assertAgentToolPolicies(TOOL_NAMES);
  assert.ok(AGENT_ACTION_POLICIES.message_send);
});

test("low-risk reviewed Gmail send can auto-send", async () => {
  const decision = await evaluateAutonomousAction({
    prisma: prisma as never,
    actor: { id: "user_1", tenantId: "tenant_a" },
    actionId: "message_send",
    channel: ChannelKind.GMAIL,
    recipient: "client@example.com",
    reviewStatus: "PASS",
    risk: MessageRisk.LOW,
    autoSend: true,
  });

  assert.equal(decision.allowed, true);
  assert.match(decision.idempotencyKey, /^[a-f0-9]{24}$/);
});

test("autonomous send blocks high-risk or unreviewed content", async () => {
  const decision = await evaluateAutonomousAction({
    prisma: prisma as never,
    actor: { id: "user_1", tenantId: "tenant_a" },
    actionId: "message_send",
    channel: ChannelKind.GMAIL,
    recipient: "client@example.com",
    reviewStatus: "NEEDS_HUMAN",
    risk: MessageRisk.HIGH,
    autoSend: true,
  });

  assert.equal(decision.allowed, false);
  assert.match(decision.reasons.join(" "), /passing review|LOW risk/i);
});
