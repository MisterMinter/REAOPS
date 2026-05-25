import { NextResponse } from "next/server";
import { availableAiProviders, defaultAiProvider } from "@/lib/ai-chat";
import { authzResponse, requireActiveUser } from "@/lib/session-guard";

export async function GET() {
  try {
    await requireActiveUser();
  } catch (error) {
    return authzResponse(error);
  }

  return NextResponse.json({
    providers: availableAiProviders(),
    defaultProvider: defaultAiProvider(),
  });
}
