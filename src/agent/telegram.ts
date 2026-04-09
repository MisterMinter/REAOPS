import type { CoreMessage } from "ai";
import { prisma } from "@/lib/prisma";
import { runAgent } from "@/agent/core";

const MAX_TG_MESSAGE = 4096;

export function truncateForTelegram(text: string): string {
  if (text.length <= MAX_TG_MESSAGE) return text;
  return text.slice(0, MAX_TG_MESSAGE - 3) + "...";
}

export async function handleTelegramMessage(
  telegramUserId: number,
  text: string,
  chatId: number
): Promise<string> {
  const user = await findUserByTelegram(telegramUserId);
  if (!user) {
    return "You're not linked to an RE Agent OS account yet. Ask your broker to add your Telegram ID in Settings.";
  }

  const sessionKey = `tg:${telegramUserId}:${chatId}`;
  const existing = await prisma.chatSession.findFirst({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
  });

  let prevMessages: CoreMessage[] = [];
  if (existing) {
    try {
      const raw = existing.messages as { role: string; content: string }[];
      prevMessages = raw
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-20)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    } catch {
      prevMessages = [];
    }
  }

  const messages: CoreMessage[] = [...prevMessages, { role: "user", content: text }];

  try {
    const result = await runAgent({
      userId: user.id,
      messages,
      chatSessionId: existing?.id,
    });
    return truncateForTelegram(result.responseText || "Done — no text response from the agent.");
  } catch (e) {
    console.error("Telegram agent error:", e);
    return "Something went wrong processing your message. Try again or check the server logs.";
  }
}

async function findUserByTelegram(telegramUserId: number) {
  const raw = String(telegramUserId);
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { contains: raw } },
      ],
    },
    select: { id: true, email: true, tenantId: true },
  });
  if (user) return user;

  const byMeta = await prisma.user.findFirst({
    where: {
      assignedListings: { path: ["telegramId"], equals: raw },
    },
    select: { id: true, email: true, tenantId: true },
  });
  return byMeta ?? null;
}
