import { NextResponse } from "next/server";
import { handleTelegramMessage } from "@/agent/telegram";

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

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: message.chat.id,
      text: reply,
      parse_mode: "Markdown",
    }),
  });

  return NextResponse.json({ ok: true });
}
