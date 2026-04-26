import type { CoreMessage } from "ai";
import { prisma } from "@/lib/prisma";
import { runAgent } from "@/agent/core";

const MAX_TG_MESSAGE = 4096;
const HISTORY_CAP = 20;

export function truncateForTelegram(text: string): string {
  if (text.length <= MAX_TG_MESSAGE) return text;
  return text.slice(0, MAX_TG_MESSAGE - 3) + "...";
}

/**
 * Send one or more HTML messages to a Telegram chat.
 * Falls back to plain text per message if HTML parsing fails.
 */
export async function sendTelegramMessages(
  botToken: string,
  chatId: number,
  messages: string[],
  options?: { topicId?: number }
): Promise<void> {
  for (const msg of messages) {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: truncateForTelegram(msg),
      parse_mode: "HTML",
    };
    if (options?.topicId) {
      payload.message_thread_id = options.topicId;
    }

    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      const desc =
        (errJson as Record<string, unknown> | null)?.description ?? "";
      const isParseError =
        typeof desc === "string" &&
        (desc.includes("can't parse") || desc.includes("Bad Request"));

      if (isParseError) {
        const stripped = msg
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">");
        const fallback: Record<string, unknown> = {
          chat_id: chatId,
          text: truncateForTelegram(stripped),
        };
        if (options?.topicId) fallback.message_thread_id = options.topicId;
        await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(fallback),
          }
        );
      }
    }

    // Small delay between messages to avoid rate limits
    if (messages.length > 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
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

  const existing = await prisma.chatSession.findFirst({
    where: {
      userId: user.id,
      channel: "telegram",
      externalChatId: String(chatId),
    },
    orderBy: { updatedAt: "desc" },
  });

  const prevMessages = existing ? deserializeHistory(existing.messages) : [];

  const messages: CoreMessage[] = [...prevMessages, { role: "user", content: text }];

  try {
    const result = await runAgent({
      userId: user.id,
      messages,
      chatSessionId: existing?.id,
      channel: "telegram",
      externalChatId: String(chatId),
    });
    return truncateForTelegram(result.responseText || "Done — no text response from the agent.");
  } catch (e) {
    console.error("Telegram agent error:", e);
    return "Something went wrong processing your message. Try again or check the server logs.";
  }
}

async function findUserByTelegram(telegramUserId: number) {
  return prisma.user.findFirst({
    where: { telegramId: String(telegramUserId) },
    select: { id: true, email: true, tenantId: true },
  });
}

/**
 * Reconstruct CoreMessage[] from the persisted JSON blob.
 * Handles both string content and structured (tool-call/tool-result) content.
 * Caps to the last HISTORY_CAP user+assistant pairs, keeping any trailing tool
 * exchange intact so the model doesn't see a broken sequence.
 */
function deserializeHistory(raw: unknown): CoreMessage[] {
  if (!Array.isArray(raw)) return [];

  const messages: CoreMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object" || !("role" in m) || !("content" in m)) continue;
    const role = (m as Record<string, unknown>).role as string;
    const content = (m as Record<string, unknown>).content;

    if (role === "user" || role === "assistant") {
      messages.push({ role, content } as CoreMessage);
    } else if (role === "tool") {
      messages.push({ role: "tool", content } as CoreMessage);
    }
  }

  let cutIdx = 0;
  let conversationalCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const r = messages[i].role;
    if (r === "user" || r === "assistant") {
      conversationalCount++;
      if (conversationalCount > HISTORY_CAP) {
        cutIdx = i + 1;
        break;
      }
    }
  }

  return messages.slice(cutIdx);
}
