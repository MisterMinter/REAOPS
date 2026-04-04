import { auth } from "@/auth";
import { type ChatMessage, resolveAiProvider, streamAiChat } from "@/lib/ai-chat";
import {
  type ListingFacts,
  marketingSystemPrompt,
  marketingUserPrompt,
} from "@/lib/marketing-generate";
import { prisma } from "@/lib/prisma";

type Body = {
  provider?: string;
  defaultTone: string;
  facts: ListingFacts;
  heroContext: string;
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return new Response(JSON.stringify({ error: "Tenant required" }), { status: 403 });
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
    where: { id: session.user.tenantId },
    select: { defaultTone: true },
  });
  const fromBody =
    typeof body.defaultTone === "string" && body.defaultTone.trim() ? body.defaultTone.trim() : "";
  const effectiveTone =
    tenant?.defaultTone?.trim() || fromBody || "Warm but professional. First-name basis. No pressure.";

  const provider = resolveAiProvider(body.provider ?? null);
  if (!provider) {
    return new Response(
      JSON.stringify({
        error: "No AI API key configured (GEMINI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY).",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const system = marketingSystemPrompt(effectiveTone);
  const userContent = marketingUserPrompt(facts, heroContext);
  const messages: ChatMessage[] = [{ role: "user", content: userContent }];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamAiChat(provider, messages, system)) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        controller.enqueue(encoder.encode(`\n\n[Error: ${msg}]`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
