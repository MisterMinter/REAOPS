import { NextRequest, NextResponse } from "next/server";
import { ChannelKind } from "@prisma/client";
import { sendTelegramMessages } from "@/agent/telegram";
import { runEnabledAgentLoops } from "@/lib/agent-loops/runner";
import { withJobRun } from "@/lib/jobs";
import { markNotificationsDelivered } from "@/lib/ops/notifications";
import { prisma } from "@/lib/prisma";
import { requireRouteSecret } from "@/lib/route-security";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const unauthorized = requireRouteSecret(req, "CRON_SECRET");
  if (unauthorized) return unauthorized;

  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const results: {
    tenant: string;
    runs: { id: string; kind: string; actionsCreated: number }[];
    telegramDelivered?: number;
    jobRunId?: string;
    skipped?: boolean;
    error?: string;
  }[] = [];

  for (const tenant of tenants) {
    try {
      const job = await withJobRun({
        prisma,
        tenantId: tenant.id,
        kind: "agent_loops",
        key: `agent-loops:${tenant.id}`,
        trigger: "cron",
        ttlMs: 20 * 60 * 1000,
        metadata: { tenantName: tenant.name },
        summarize: (result) => `Ran ${result.runs.length} due agent loop(s).`,
        resultMetadata: (result) => ({
          tenantName: tenant.name,
          runs: result.runs.length,
          telegramDelivered: result.telegramDelivered,
        }),
        run: async () => {
          const runs = await runEnabledAgentLoops({
            tenantId: tenant.id,
            trigger: "cron",
            respectCadence: true,
          });
          const telegramDelivered = await deliverTelegramUpdates(
            tenant.id,
            runs.map((run) => run.runId)
          );
          return {
            tenant: tenant.name,
            runs: runs.map((run) => ({
              id: run.runId,
              kind: run.kind,
              actionsCreated: run.actions.length,
            })),
            telegramDelivered,
          };
        },
      });

      results.push(
        job.status === "skipped"
          ? {
              tenant: tenant.name,
              runs: [],
              jobRunId: job.jobRunId,
              skipped: true,
              error: "Skipped because another agent-loop run is active.",
            }
          : { ...job.result, jobRunId: job.jobRunId }
      );
    } catch (e) {
      console.error(`[agent-loops-cron] Failed for tenant ${tenant.name}:`, e);
      results.push({
        tenant: tenant.name,
        runs: [],
        error: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    tenants: results,
    timestamp: new Date().toISOString(),
  });
}

async function deliverTelegramUpdates(tenantId: string, runIds: string[]) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || runIds.length === 0) return 0;

  const notifications = await prisma.agentNotification.findMany({
    where: {
      tenantId,
      agentRunId: { in: runIds },
      deliveredAt: null,
      user: { telegramId: { not: null }, isActive: true },
    },
    include: { user: { select: { telegramId: true } } },
    orderBy: { createdAt: "asc" },
  });

  let delivered = 0;
  const deliveredIds: string[] = [];
  for (const notification of notifications) {
    const chatId = Number(notification.user?.telegramId);
    if (!chatId || isNaN(chatId)) continue;
    try {
      await sendTelegramMessages(botToken, chatId, [
        `<b>${escapeTelegram(notification.title)}</b>\n\n${escapeTelegram(notification.body)}${
          notification.href ? `\n\nOpen: ${escapeTelegram(notification.href)}` : ""
        }`,
      ]);
      delivered += 1;
      deliveredIds.push(notification.id);
    } catch (e) {
      console.error("[agent-loops-cron] Telegram notification failed:", e);
    }
  }

  await markNotificationsDelivered({
    prisma,
    ids: deliveredIds,
    channel: ChannelKind.TELEGRAM,
  });
  return delivered;
}

function escapeTelegram(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
