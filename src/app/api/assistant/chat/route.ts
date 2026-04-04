import { auth } from "@/auth";
import { type ChatMessage, resolveAiProvider, streamAiChat } from "@/lib/ai-chat";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  if (!session.user.tenantId) {
    return new Response(JSON.stringify({ error: "Tenant required" }), { status: 403 });
  }

  let body: { messages?: ChatMessage[]; provider?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const raw = body.messages?.filter((m) => typeof m.content === "string" && m.content.trim()) ?? [];
  const messages: ChatMessage[] = raw.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content.trim(),
  }));

  if (!messages.length) {
    return new Response(JSON.stringify({ error: "messages required" }), { status: 400 });
  }

  const provider = resolveAiProvider(body.provider ?? null);
  if (!provider) {
    return new Response(
      JSON.stringify({
        error:
          "No AI API key configured. Set GEMINI_API_KEY (preferred), ANTHROPIC_API_KEY, or OPENAI_API_KEY on the server.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const system = [
    "You are RE Agent OS, a concise real-estate brokerage workspace assistant.",
    `User role: ${session.user.role}.`,
    "Prefer short paragraphs and bullet points. If data is missing, say what you need.",
  ].join(" ");

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
