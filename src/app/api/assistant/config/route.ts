import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { availableAiProviders, defaultAiProvider } from "@/lib/ai-chat";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    providers: availableAiProviders(),
    defaultProvider: defaultAiProvider(),
  });
}
