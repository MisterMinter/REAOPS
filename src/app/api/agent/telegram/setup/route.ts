import { NextResponse } from "next/server";
import { registerTelegramWebhook } from "@/lib/telegram-webhook";

export async function POST() {
  const result = await registerTelegramWebhook();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
