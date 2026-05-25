import type { CoreMessage } from "ai";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { getTenantBrain } from "@/lib/tenant-brain";
import type { TenantBrainMemory } from "@/lib/tenant-brain/types";

export type AgentMemoryContext = {
  memories: TenantBrainMemory[];
  citations: string[];
  degraded: boolean;
  error?: string;
};

export async function loadAgentMemoryContext(input: {
  prisma?: PrismaClient;
  tenantId: string | null;
  userId: string;
  messages: CoreMessage[];
}): Promise<AgentMemoryContext> {
  if (!input.tenantId) return { memories: [], citations: [], degraded: true };
  const query = buildMemoryQuery(input.messages);
  if (!query) return { memories: [], citations: [], degraded: false };

  const prisma = input.prisma ?? defaultPrisma;
  try {
    const result = await getTenantBrain().query({
      tenantId: input.tenantId,
      userId: input.userId,
      query,
      limit: 6,
    });
    return {
      memories: result.memories,
      citations: result.citations,
      degraded: Boolean(result.degraded),
      error: result.error,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Tenant brain query failed.";
    await prisma.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        action: "tenant_brain.query_failed",
        subjectType: "User",
        subjectId: input.userId,
        metadata: { error, query: query.slice(0, 500) },
      },
    });
    return { memories: [], citations: [], degraded: true, error };
  }
}

export function formatAgentMemoryForPrompt(memory: AgentMemoryContext): string {
  if (memory.memories.length === 0) {
    return memory.degraded
      ? "Tenant brain memory: unavailable or not configured. Use current database/tool context only."
      : "Tenant brain memory: no relevant durable memories found.";
  }

  const lines = ["Tenant brain memory (concise, source-cited, may be stale; verify before external action):"];
  for (const item of memory.memories.slice(0, 6)) {
    const source = item.source || [item.subjectType, item.subjectId].filter(Boolean).join(":") || item.id;
    lines.push(`- ${item.title}: ${trimForPrompt(item.content, 420)} [${source}]`);
  }
  if (memory.citations.length > 0) {
    lines.push(`Citations: ${memory.citations.slice(0, 6).join(", ")}`);
  }
  return lines.join("\n");
}

function buildMemoryQuery(messages: CoreMessage[]) {
  const recent = messages
    .filter((m) => m.role === "user" && typeof m.content === "string")
    .slice(-3)
    .map((m) => String(m.content).trim())
    .filter(Boolean);
  return recent.join("\n").slice(0, 1000);
}

function trimForPrompt(value: string, max: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}
