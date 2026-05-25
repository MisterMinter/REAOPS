import { runAgent } from "@/agent/core";
import type { CoreMessage } from "ai";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { authzResponse, requireTenantUser } from "@/lib/session-guard";

export async function POST(req: Request) {
  let user;
  try {
    user = await requireTenantUser();
  } catch (error) {
    return authzResponse(error);
  }

  const limited = checkRateLimit(`assistant-chat:${user.id}`, { limit: 60, windowMs: 60_000 });
  if (!limited.ok) {
    return new Response(JSON.stringify({ error: "Too many chat requests." }), {
      status: 429,
      headers: { "Content-Type": "application/json", ...rateLimitHeaders(limited) },
    });
  }

  let body: { messages?: { role: string; content: string }[]; provider?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const raw = body.messages?.filter((m) => typeof m.content === "string" && m.content.trim()) ?? [];
  const messages: CoreMessage[] = raw.map((m) => ({
    role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
    content: m.content.trim(),
  }));

  if (!messages.length) {
    return new Response(JSON.stringify({ error: "messages required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await runAgent({
      userId: user.id,
      messages,
      provider: body.provider,
    });

    return new Response(
      JSON.stringify({ text: result.responseText, chatSessionId: result.chatSessionId }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Assistant chat (agent) error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Agent execution failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
