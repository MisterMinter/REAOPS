import { streamText } from "ai";
import { resolveLanguageModel } from "@/lib/ai-chat";
import {
  type ListingFacts,
  marketingSystemPrompt,
  marketingUserPrompt,
} from "@/lib/marketing-generate";
import { prisma } from "@/lib/prisma";
import { authzResponse, requireTenantUser } from "@/lib/session-guard";

type Body = {
  provider?: string;
  defaultTone: string;
  facts: ListingFacts;
  heroContext: string;
};

export async function POST(req: Request) {
  let user;
  try {
    user = await requireTenantUser();
  } catch (error) {
    return authzResponse(error);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const facts = body.facts;
  if (!facts || typeof facts.address !== "string") {
    return new Response(JSON.stringify({ error: "listing facts required" }), { status: 400 });
  }

  const heroContext =
    typeof body.heroContext === "string" && body.heroContext.trim()
      ? body.heroContext.trim()
      : "Not specified.";

  const tenant = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { defaultTone: true },
  });
  const fromBody =
    typeof body.defaultTone === "string" && body.defaultTone.trim() ? body.defaultTone.trim() : "";
  const effectiveTone =
    tenant?.defaultTone?.trim() || fromBody || "Warm but professional. First-name basis. No pressure.";

  const model = resolveLanguageModel(body.provider ?? null);
  if (!model) {
    return new Response(
      JSON.stringify({
        error: "No AI API key configured (GEMINI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY).",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const result = streamText({
    model,
    system: marketingSystemPrompt(effectiveTone),
    prompt: marketingUserPrompt(facts, heroContext),
  });

  return result.toTextStreamResponse();
}
