"use client";

import { useEffect, useRef, useState } from "react";

type ChatMessage = { role: "user" | "assistant"; content: string };
type ProviderKey = "gemini" | "anthropic" | "openai";

export function AssistantComposer() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<ProviderKey | "">("");
  const [providers, setProviders] = useState<Partial<Record<ProviderKey, boolean>>>({});
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/assistant/config")
      .then((r) => r.json())
      .then((d: { providers?: Partial<Record<ProviderKey, boolean>>; defaultProvider?: ProviderKey | null }) => {
        if (cancelled) return;
        setProviders(d.providers ?? {});
        if (d.defaultProvider) setProvider(d.defaultProvider);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const configured = Object.values(providers).some(Boolean);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          provider: provider || undefined,
          chatSessionId: chatSessionId ?? undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: data.error ?? res.statusText },
        ]);
        setLoading(false);
        return;
      }

      if (data.chatSessionId) setChatSessionId(data.chatSessionId);

      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.text || "(No response)" },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: e instanceof Error ? e.message : "Request failed" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-8 flex flex-col rounded-lg border border-[var(--border)] bg-[var(--card)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="text-sm font-medium text-[var(--txt)]">Agent Chat</div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-[var(--txt3)]">Model provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderKey | "")}
            disabled={!configured}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--txt)] disabled:opacity-50"
          >
            <option value="">Default (env order)</option>
            {providers.gemini && <option value="gemini">Gemini</option>}
            {providers.anthropic && <option value="anthropic">Anthropic</option>}
            {providers.openai && <option value="openai">OpenAI</option>}
          </select>
        </div>
      </div>

      {!configured && (
        <p className="border-b border-[var(--border)] bg-[var(--amber)]/10 px-4 py-3 text-sm text-[var(--amber)]">
          Add <code className="text-[var(--teal)]">GEMINI_API_KEY</code>,{" "}
          <code className="text-[var(--teal)]">ANTHROPIC_API_KEY</code>, or{" "}
          <code className="text-[var(--teal)]">OPENAI_API_KEY</code> in Railway (or{" "}
          <code className="text-[var(--teal)]">.env</code> locally).
        </p>
      )}

      <div className="max-h-[32rem] min-h-[14rem] space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-sm text-[var(--txt3)]">
            Ask about listings, marketing copy, calendar, follow-ups, or portfolio analysis. The agent
            has tools for Drive, Calendar, Zillow, marketing generation, and more.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded-md px-3 py-2 text-sm ${
              m.role === "user"
                ? "ml-8 bg-[var(--teal)]/15 text-[var(--txt)]"
                : "mr-8 bg-[var(--surface)] text-[var(--txt2)]"
            }`}
          >
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--txt3)]">
              {m.role === "user" ? "You" : "Agent"}
            </div>
            <div className="whitespace-pre-wrap">{m.content}</div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-[var(--txt3)]">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--gold)]" />
            Agent is thinking and may be calling tools...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-[var(--border)] p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={3}
            placeholder="Message the agent... (Enter to send, Shift+Enter for newline)"
            disabled={loading || !configured}
            className="min-h-[5rem] w-full flex-1 resize-y rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--txt)] placeholder:text-[var(--txt3)] disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={loading || !configured || !input.trim()}
            className="shrink-0 rounded-md bg-[var(--gold)] px-5 py-2 text-sm font-semibold text-[var(--bg)] disabled:opacity-50"
          >
            {loading ? "Working..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
