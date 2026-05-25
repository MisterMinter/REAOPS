import test from "node:test";
import assert from "node:assert/strict";
import { formatBriefPlainText } from "@/lib/daily-brief-format";
import type { DailyBriefData } from "@/lib/daily-brief";

test("daily brief includes ops, gaps, and tenant brain context", () => {
  const data: DailyBriefData = {
    tenantName: "Atlanta Premier",
    date: "Monday, May 25, 2026",
    activeCount: 3,
    pendingCount: 1,
    closedMtdCount: 2,
    avgDom: 21,
    domTarget: 30,
    listingHighlights: [],
    showings: [],
    calendarError: null,
    followUp: {
      totalContacts: 10,
      byStatus: { Hot: 2 },
      contactedLast7d: 4,
      staleContacts: [{ name: "Pat Client", leadStatus: "Hot", daysSinceContact: 21 }],
      todayReminders: [],
      overdueDays: 21,
    },
    marketingItems: [],
    complianceStandard: "ga_residential",
    pendingApprovalCount: 2,
    openTaskCount: 5,
    waitingDraftCount: 1,
    campaignGapCount: 3,
    complianceFlagCount: 1,
    recentChanges: ["message.draft on MessageDraft abc123"],
    missingInfo: ["Some active listings are missing linked Drive folders."],
    tenantBrainMemories: [{ id: "m1", title: "Brand rule", content: "Use a calm no-pressure tone." }],
    tenantBrainError: null,
    recommendation: "Review stale leads before lunch.",
  };

  const text = formatBriefPlainText(data, "Feroz");

  assert.match(text, /Pending approvals: 2/);
  assert.match(text, /Campaign gaps: 3/);
  assert.match(text, /Tenant brain context/);
  assert.match(text, /Brand rule/);
});
