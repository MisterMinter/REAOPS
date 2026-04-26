import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getGoogleAccessTokenForUser } from "@/lib/google-account-token";
import { buildDailyBrief } from "@/lib/daily-brief";
import { formatBriefForTelegram } from "@/lib/daily-brief-format";
import { sendTelegramMessages } from "@/agent/telegram";

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
  if (!botToken) {
    return NextResponse.json(
      { error: "TELEGRAM_BOT_TOKEN not set" },
      { status: 503 }
    );
  }

  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      users: {
        where: {
          isActive: true,
          telegramId: { not: null },
        },
        select: {
          id: true,
          name: true,
          telegramId: true,
        },
      },
    },
  });

  const results: { tenant: string; users: number; error?: string }[] = [];

  for (const tenant of tenants) {
    const tgUsers = tenant.users.filter((u) => u.telegramId);
    if (tgUsers.length === 0) {
      results.push({ tenant: tenant.name, users: 0 });
      continue;
    }

    // Get a Google token from any user in the tenant for calendar/Drive
    let accessToken: string | null = null;
    for (const u of tgUsers) {
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
      const briefData = await buildDailyBrief(tenant.id, accessToken);

      for (const user of tgUsers) {
        const chatId = Number(user.telegramId);
        if (!chatId || isNaN(chatId)) continue;

        const userName = user.name?.split(" ")[0] ?? "there";
        const messages = formatBriefForTelegram(briefData, userName);

        try {
          await sendTelegramMessages(botToken, chatId, messages);
        } catch (e) {
          console.error(
            `[daily-brief-cron] Failed to send to ${user.telegramId}:`,
            e
          );
        }
      }

      results.push({ tenant: tenant.name, users: tgUsers.length });
    } catch (e) {
      console.error(
        `[daily-brief-cron] Failed for tenant ${tenant.name}:`,
        e
      );
      results.push({
        tenant: tenant.name,
        users: tgUsers.length,
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
