import { NextResponse } from "next/server";
import { registerTelegramWebhook } from "@/lib/telegram-webhook";
import { authzResponse, requireActiveUser } from "@/lib/session-guard";

export async function POST() {
  try {
    await requireActiveUser({ canEditBrokerage: true });
    const result = await registerTelegramWebhook();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    return authzResponse(error);
  }
}
