import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

export type AiProviderName = "gemini" | "anthropic" | "openai";

export function availableAiProviders(): Record<AiProviderName, boolean> {
  return {
    gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
  };
}

export function defaultAiProvider(): AiProviderName | null {
  const avail = availableAiProviders();
  const order = (process.env.AI_PROVIDER ?? "gemini,anthropic,openai")
    .split(",")
    .map((s) => s.trim().toLowerCase());

  for (const raw of order) {
    const p = raw as AiProviderName;
    if (p === "gemini" && avail.gemini) return "gemini";
    if (p === "anthropic" && avail.anthropic) return "anthropic";
    if (p === "openai" && avail.openai) return "openai";
  }
  if (avail.gemini) return "gemini";
  if (avail.anthropic) return "anthropic";
  if (avail.openai) return "openai";
  return null;
}

export function resolveAiProvider(requested?: string | null): AiProviderName | null {
  const avail = availableAiProviders();
  const p = (requested ?? "").toLowerCase() as AiProviderName;
  if (p === "gemini" && avail.gemini) return "gemini";
  if (p === "anthropic" && avail.anthropic) return "anthropic";
  if (p === "openai" && avail.openai) return "openai";
  return defaultAiProvider();
}

async function* streamGemini(messages: ChatMessage[], system: string): AsyncGenerator<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");

  const modelName = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: system,
  });

  const convo = messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "assistant" ? "assistant" : "user"}: ${m.content}`)
    .join("\n\n");

  const stream = await model.generateContentStream(convo);
  for await (const chunk of stream.stream) {
    const t = chunk.text();
    if (t) yield t;
  }
}

async function* streamAnthropic(messages: ChatMessage[], system: string): AsyncGenerator<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");

  const anthropic = new Anthropic({ apiKey: key });
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

  const msgs = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const stream = await anthropic.messages.stream({
    model,
    max_tokens: 4096,
    system,
    messages: msgs,
  });

  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      yield ev.delta.text;
    }
  }
}

async function* streamOpenAI(messages: ChatMessage[], system: string): AsyncGenerator<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");

  const openai = new OpenAI({ apiKey: key });
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    ...messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      })),
  ];

  const stream = await openai.chat.completions.create({
    model,
    messages: msgs,
    stream: true,
  });

  for await (const part of stream) {
    const t = part.choices[0]?.delta?.content;
    if (t) yield t;
  }
}

export async function* streamAiChat(
  provider: AiProviderName,
  messages: ChatMessage[],
  system: string
): AsyncGenerator<string> {
  switch (provider) {
    case "gemini":
      yield* streamGemini(messages, system);
      return;
    case "anthropic":
      yield* streamAnthropic(messages, system);
      return;
    case "openai":
      yield* streamOpenAI(messages, system);
      return;
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}
