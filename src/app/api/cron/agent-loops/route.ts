import { NextRequest, NextResponse } from "next/server";
import { ChannelKind } from "@prisma/client";
import { sendTelegramMessages } from "@/agent/telegram";
import { runEnabledAgentLoops } from "@/lib/agent-loops/runner";
import { markNotificationsDelivered } from "@/lib/ops/notifications";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

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

  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const results: {
    tenant: string;
    runs: { id: string; kind: string; actionsCreated: number }[];
    telegramDelivered?: number;
    error?: string;
  }[] = [];

  for (const tenant of tenants) {
    try {
      const runs = await runEnabledAgentLoops({
        tenantId: tenant.id,
        trigger: "cron",
        respectCadence: true,
      });
      const telegramDelivered = await deliverTelegramUpdates(
        tenant.id,
        runs.map((run) => run.runId)
      );
      results.push({
        tenant: tenant.name,
        runs: runs.map((run) => ({
          id: run.runId,
          kind: run.kind,
          actionsCreated: run.actions.length,
        })),
        telegramDelivered,
      });
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
