import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";

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
    if (avail[p]) return p;
  }
  if (avail.gemini) return "gemini";
  if (avail.anthropic) return "anthropic";
  if (avail.openai) return "openai";
  return null;
}

export function resolveAiProvider(requested?: string | null): AiProviderName | null {
  const avail = availableAiProviders();
  const p = (requested ?? "").toLowerCase() as AiProviderName;
  if (avail[p]) return p;
  return defaultAiProvider();
}

export function getLanguageModel(provider: AiProviderName): LanguageModelV1 {
  switch (provider) {
    case "gemini": {
      const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });
      return google(process.env.GEMINI_MODEL ?? "gemini-2.0-flash");
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
      return anthropic(process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6");
    }
    case "openai": {
      const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! });
      return openai(process.env.OPENAI_MODEL ?? "gpt-4o-mini");
    }
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}

export function resolveLanguageModel(requested?: string | null): LanguageModelV1 | null {
  const provider = resolveAiProvider(requested);
  if (!provider) return null;
  return getLanguageModel(provider);
}
