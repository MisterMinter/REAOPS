import { NextRequest, NextResponse } from "next/server";
import {
  AgentLoopKind,
  AgentNotificationSeverity,
  AgentRunStatus,
  ChannelKind,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getGoogleAccessTokenForUser } from "@/lib/google-account-token";
import { buildDailyBrief, type DailyBriefData } from "@/lib/daily-brief";
import { formatBriefForTelegram } from "@/lib/daily-brief-format";
import { sendTelegramMessages } from "@/agent/telegram";
import { ingestTenantBusinessFacts } from "@/lib/tenant-brain/ingest";
import {
  createAgentNotifications,
  markNotificationsDelivered,
} from "@/lib/ops/notifications";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const url = new URL(req.url);
    const token =
      url.searchParams.get("secret") ??
      req.headers.get("authorization")?.replace("Bearer ", "");
    if (token !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      users: {
        where: {
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          telegramId: true,
        },
      },
    },
  });

  const results: { tenant: string; telegramUsers: number; notifications?: number; runId?: string; error?: string }[] = [];

  for (const tenant of tenants) {
    const tgUsers = tenant.users.filter((u) => u.telegramId);

    // Get a Google token from any user in the tenant for calendar/Drive
    let accessToken: string | null = null;
    for (const u of tenant.users) {
      accessToken = await getGoogleAccessTokenForUser(u.id);
      if (accessToken) break;
    }
    if (!accessToken) {
      const allUsers = await prisma.user.findMany({
        where: { tenantId: tenant.id, isActive: true },
        select: { id: true },
        take: 5,
      });
      for (const u of allUsers) {
        accessToken = await getGoogleAccessTokenForUser(u.id);
        if (accessToken) break;
      }
    }

    try {
      await ingestTenantBusinessFacts({
        tenantId: tenant.id,
        reason: "daily_brief",
      });
      const briefData = await buildDailyBrief(tenant.id, accessToken);
      const run = await persistDailyBriefRun(tenant.id, briefData);
      const notifications = await createAgentNotifications({
        tenantId: tenant.id,
        agentRunId: run.id,
        title: "Daily broker brief",
        body: notificationBody(briefData),
        href: "/command",
        severity:
          briefData.pendingApprovalCount > 0 || briefData.complianceFlagCount > 0
            ? AgentNotificationSeverity.ACTION
            : AgentNotificationSeverity.INFO,
        metadata: {
          source: "daily_brief",
          activeCount: briefData.activeCount,
          pendingApprovalCount: briefData.pendingApprovalCount,
          campaignGapCount: briefData.campaignGapCount,
          complianceFlagCount: briefData.complianceFlagCount,
        },
      });

      const deliveredIds: string[] = [];
      for (const user of tgUsers) {
        if (!botToken) continue;
        const chatId = Number(user.telegramId);
        if (!chatId || isNaN(chatId)) continue;

        const userName = user.name?.split(" ")[0] ?? "there";
        const messages = formatBriefForTelegram(briefData, userName);

        try {
          await sendTelegramMessages(botToken, chatId, messages);
          deliveredIds.push(...notifications.filter((n) => n.userId === user.id).map((n) => n.id));
        } catch (e) {
          console.error(
            `[daily-brief-cron] Failed to send to ${user.telegramId}:`,
            e
          );
        }
      }
      await markNotificationsDelivered({
        ids: deliveredIds,
        channel: ChannelKind.TELEGRAM,
      });

      results.push({
        tenant: tenant.name,
        telegramUsers: tgUsers.length,
        notifications: notifications.length,
        runId: run.id,
      });
    } catch (e) {
      console.error(
        `[daily-brief-cron] Failed for tenant ${tenant.name}:`,
        e
      );
      results.push({
        tenant: tenant.name,
        telegramUsers: tgUsers.length,
        error: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    sent: results,
    timestamp: new Date().toISOString(),
  });
}

async function persistDailyBriefRun(tenantId: string, brief: DailyBriefData) {
  const loop = await prisma.agentLoop.upsert({
    where: { tenantId_kind: { tenantId, kind: AgentLoopKind.DAILY_OPS } },
    create: {
      tenantId,
      kind: AgentLoopKind.DAILY_OPS,
      name: "Daily Ops Manager",
      cadence: "weekday_morning",
      enabled: true,
    },
    update: {},
  });
  const summary = notificationBody(brief);
  return prisma.agentRun.create({
    data: {
      tenantId,
      loopId: loop.id,
      kind: AgentLoopKind.DAILY_OPS,
      trigger: "daily_brief",
      status: AgentRunStatus.SUCCEEDED,
      summary,
      observations: [
        { type: "active_listings", count: brief.activeCount },
        { type: "stale_contacts", count: brief.followUp.staleContacts.length },
        { type: "pending_approvals", count: brief.pendingApprovalCount },
        { type: "campaign_gaps", count: brief.campaignGapCount },
        { type: "compliance_flags", count: brief.complianceFlagCount },
        { type: "missing_info", count: brief.missingInfo.length },
      ] as Prisma.InputJsonValue,
      actions: [
        ...brief.followUp.staleContacts.slice(0, 5).map((contact) => ({
          type: "follow_up",
          label: `Follow up with ${contact.name}`,
          href: "/follow-up",
        })),
        ...(brief.pendingApprovalCount > 0
          ? [{ type: "approval", label: `${brief.pendingApprovalCount} approval(s) waiting`, href: "/command" }]
          : []),
        ...(brief.campaignGapCount > 0
          ? [{ type: "marketing", label: `${brief.campaignGapCount} campaign/listing gap(s)`, href: "/marketing" }]
          : []),
      ] as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });
}

function notificationBody(brief: DailyBriefData) {
  const lines = [
    `${brief.tenantName}: ${brief.activeCount} active, ${brief.pendingCount} pending, ${brief.closedMtdCount} closed MTD.`,
    `${brief.followUp.staleContacts.length} stale follow-up(s), ${brief.pendingApprovalCount} approval(s), ${brief.campaignGapCount} campaign gap(s), ${brief.complianceFlagCount} compliance flag(s).`,
    brief.missingInfo.length ? `Missing info: ${brief.missingInfo.slice(0, 3).join(" ")}` : "",
    brief.recommendation ? `Recommendation: ${brief.recommendation}` : "",
  ];
  return lines.filter(Boolean).join("\n").slice(0, 1600);
}
