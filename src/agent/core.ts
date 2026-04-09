import { generateText } from "ai";
import type { CoreMessage } from "ai";
import {
  resolveAiProvider,
  fallbackProviders,
  getLanguageModel,
} from "@/lib/ai-chat";
import { prisma } from "@/lib/prisma";
import { buildAgentContext, buildSystemPrompt } from "@/agent/system-prompt";
import { driveTools } from "@/agent/skills/drive";
import { listingTools } from "@/agent/skills/listings";
import { zillowTools } from "@/agent/skills/zillow";
import { marketingTools } from "@/agent/skills/marketing";
import { bufferTools } from "@/agent/skills/buffer";
import { calendarTools } from "@/agent/skills/calendar";
import { followupTools } from "@/agent/skills/followup";
import { analysisTools } from "@/agent/skills/analysis";
import { flyerTools } from "@/agent/skills/flyer";

export type AgentInput = {
  userId: string;
  messages: CoreMessage[];
  provider?: string;
  chatSessionId?: string;
  channel?: string;
  externalChatId?: string;
};

export type AgentResult = {
  responseText: string;
  messages: CoreMessage[];
  chatSessionId: string;
};

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const primary = resolveAiProvider(input.provider);
  if (!primary) {
    return {
      responseText:
        "No AI API key configured. Set ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY on the server.",
      messages: input.messages,
      chatSessionId: input.chatSessionId ?? "",
    };
  }

  const ctx = await buildAgentContext(prisma, input.userId);
  if (!ctx) {
    return {
      responseText: "User not found.",
      messages: input.messages,
      chatSessionId: input.chatSessionId ?? "",
    };
  }

  const system = buildSystemPrompt(ctx);

  const accessToken = await getAccessToken(input.userId);
  const toolCtx = {
    accessToken,
    tenantId: ctx.tenantId,
    driveRootFolderId: ctx.driveRootFolderId,
    defaultTone: ctx.defaultTone,
    flyerNotifyEmail: ctx.flyerNotifyEmail,
    brokerPhone: ctx.brokerPhone,
  };

  const allTools = {
    ...driveTools(toolCtx),
    ...listingTools(toolCtx),
    ...zillowTools(toolCtx),
    ...marketingTools(toolCtx),
    ...bufferTools(toolCtx),
    ...calendarTools(toolCtx),
    ...followupTools(toolCtx),
    ...analysisTools(toolCtx),
    ...flyerTools(toolCtx),
  };

  const providersToTry = [primary, ...fallbackProviders(primary)];
  let lastError: unknown;

  for (const providerName of providersToTry) {
    try {
      const model = getLanguageModel(providerName);
      const result = await generateText({
        model,
        system,
        messages: input.messages,
        tools: allTools,
        maxSteps: 12,
      });

      const allMessages: CoreMessage[] = [
        ...input.messages,
        ...result.response.messages,
      ];

      const sessionId = await persistConversation(
        input.userId,
        input.chatSessionId,
        allMessages,
        input.channel,
        input.externalChatId
      );

      return {
        responseText: result.text,
        messages: allMessages,
        chatSessionId: sessionId,
      };
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : "";
      const isRetryable =
        msg.includes("429") ||
        msg.includes("rate") ||
        msg.includes("quota") ||
        msg.includes("exceeded") ||
        msg.includes("overloaded") ||
        msg.includes("503");
      if (!isRetryable) throw e;
      console.warn(`Provider ${providerName} failed (${msg.slice(0, 120)}), trying next...`);
    }
  }

  throw lastError;
}

async function getAccessToken(userId: string): Promise<string | null> {
  const { getGoogleAccessTokenForUser } = await import("@/lib/google-account-token");
  return getGoogleAccessTokenForUser(userId);
}

async function persistConversation(
  userId: string,
  existingId: string | undefined,
  messages: CoreMessage[],
  channel?: string,
  externalChatId?: string
): Promise<string> {
  const serializable = messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    return { role: m.role, content: m.content };
  });

  if (existingId) {
    await prisma.chatSession.update({
      where: { id: existingId },
      data: { messages: serializable as unknown as import("@prisma/client").Prisma.InputJsonValue },
    });
    return existingId;
  }

  const session = await prisma.chatSession.create({
    data: {
      userId,
      channel: channel ?? "web",
      externalChatId: externalChatId ?? null,
      messages: serializable as unknown as import("@prisma/client").Prisma.InputJsonValue,
    },
  });
  return session.id;
}
