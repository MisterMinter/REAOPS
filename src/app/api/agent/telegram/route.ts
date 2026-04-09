import { NextResponse } from "next/server";
import { handleTelegramMessage, truncateForTelegram } from "@/agent/telegram";

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
  const sendResult = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: message.chat.id,
      text: truncateForTelegram(htmlBody),
      parse_mode: "HTML",
    }),
  });

  if (!sendResult.ok) {
    const errJson = await sendResult.json().catch(() => null);
    const errDesc = (errJson as Record<string, unknown> | null)?.description ?? "";
    const isParseError =
      typeof errDesc === "string" &&
      (errDesc.includes("can't parse") || errDesc.includes("Bad Request"));

    if (isParseError) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: message.chat.id,
          text: truncateForTelegram(reply),
        }),
      });
    }
  }

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
