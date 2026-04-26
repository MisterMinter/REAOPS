import { NextResponse } from "next/server";
import {
  handleTelegramMessage,
  sendTelegramMessages,
  truncateForTelegram,
} from "@/agent/telegram";

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const token = url.searchParams.get("secret");
    if (token !== secret) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN not set" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const message = body.message as
    | { chat?: { id?: number }; from?: { id?: number }; text?: string }
    | undefined;
  if (!message?.chat?.id || !message?.from?.id || !message?.text) {
    return NextResponse.json({ ok: true });
  }

  const reply = await handleTelegramMessage(
    message.from.id,
    message.text,
    message.chat.id
  );

  const htmlBody = markdownToTelegramHtml(reply);
  await sendTelegramMessages(botToken, message.chat.id, [htmlBody]);

  return NextResponse.json({ ok: true });
}

/**
 * Convert the LLM's markdown-ish output to Telegram-safe HTML.
 * Telegram supports: <b>, <i>, <code>, <pre>, <a href>.
 * Anything the regex misses stays as escaped plain text.
 */
function markdownToTelegramHtml(md: string): string {
  let out = md;

  out = out.replace(/&/g, "&amp;");
  out = out.replace(/</g, "&lt;");
  out = out.replace(/>/g, "&gt;");

  out = out.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => `<pre>${code.trimEnd()}</pre>`);
  out = out.replace(/```([\s\S]*?)```/g, (_m, code) => `<pre>${code.trimEnd()}</pre>`);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  out = out.replace(/__(.+?)__/g, "<b>$1</b>");
  out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
  out = out.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<i>$1</i>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  return out;
}
