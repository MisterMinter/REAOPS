import { auth } from "@/auth";
import { runAgent } from "@/agent/core";
import type { CoreMessage } from "ai";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!session.user.tenantId) {
    return new Response(JSON.stringify({ error: "Tenant required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { messages?: { role: string; content: string }[]; provider?: string; chatSessionId?: string };
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
      userId: session.user.id,
      messages,
      provider: body.provider,
      chatSessionId: body.chatSessionId,
    });

    return new Response(
      JSON.stringify({
        text: result.responseText,
        chatSessionId: result.chatSessionId,
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    console.error("Agent chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Agent execution failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
