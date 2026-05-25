import type {
  TenantBrain,
  TenantBrainDecisionInput,
  TenantBrainGap,
  TenantBrainGapsInput,
  TenantBrainGapsResult,
  TenantBrainHealth,
  TenantBrainIngestInput,
  TenantBrainMaintenanceInput,
  TenantBrainMemory,
  TenantBrainQueryInput,
  TenantBrainQueryResult,
} from "@/lib/tenant-brain/types";

type GBrainConfig = {
  baseUrl: string;
  apiKey: string | null;
  ingestPath: string;
  queryPath: string;
  gapsPath: string;
  decisionPath: string;
  consolidatePath: string;
  healthPath: string;
  timeoutMs: number;
};

class DisabledTenantBrain implements TenantBrain {
  async ingest(input: TenantBrainIngestInput) {
    return { ok: true, count: input.documents.length };
  }

  async query(): Promise<TenantBrainQueryResult> {
    return { memories: [], citations: [], degraded: true };
  }

  async gaps(): Promise<TenantBrainGapsResult> {
    return { gaps: [], stale: [], citations: [], degraded: true };
  }

  async captureDecision(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  async consolidate(): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
    return { ok: true, skipped: true };
  }

  async health(): Promise<TenantBrainHealth> {
    return { ok: true, provider: "disabled", configured: false };
  }
}

class GBrainHttpTenantBrain implements TenantBrain {
  constructor(private readonly config: GBrainConfig) {}

  async ingest(input: TenantBrainIngestInput) {
    if (input.documents.length === 0) return { ok: true, count: 0 };
    const res = await this.post(this.config.ingestPath, {
      scope: tenantScope(input.tenantId, input.userId),
      reason: input.reason ?? "business_fact_sync",
      documents: input.documents,
    });
    return { ok: true, count: numberFrom(res.count, input.documents.length) };
  }

  async query(input: TenantBrainQueryInput): Promise<TenantBrainQueryResult> {
    const res = await this.post(this.config.queryPath, {
      scope: tenantScope(input.tenantId, input.userId),
      query: input.query,
      limit: input.limit ?? 6,
      filters: input.filters ?? {},
    });
    const rawMemories = Array.isArray(res.memories)
      ? res.memories
      : Array.isArray(res.results)
        ? res.results
        : Array.isArray(res.items)
          ? res.items
          : [];
    const memories = rawMemories.map(normalizeMemory).filter(Boolean) as TenantBrainMemory[];
    return {
      memories,
      citations: citationsFrom(memories),
      degraded: false,
    };
  }

  async gaps(input: TenantBrainGapsInput): Promise<TenantBrainGapsResult> {
    const res = await this.post(this.config.gapsPath, {
      scope: tenantScope(input.tenantId, input.userId),
      query:
        input.query ??
        "Find missing, stale, contradictory, or low-confidence brokerage operating facts.",
      limit: input.limit ?? 12,
    });
    const rawGaps = Array.isArray(res.gaps)
      ? res.gaps
      : Array.isArray(res.items)
        ? res.items
        : Array.isArray(res.results)
          ? res.results
          : [];
    const rawStale = Array.isArray(res.stale)
      ? res.stale
      : Array.isArray(res.staleFacts)
        ? res.staleFacts
        : [];
    const gaps = rawGaps.map((gap) => normalizeGap(gap, "warning")).filter(Boolean) as TenantBrainGap[];
    const stale = rawStale.map((gap) => normalizeGap(gap, "warning")).filter(Boolean) as TenantBrainGap[];
    return {
      gaps,
      stale,
      citations: citationsFrom([...gapMemories(gaps), ...gapMemories(stale)]),
      degraded: false,
    };
  }

  async captureDecision(input: TenantBrainDecisionInput) {
    await this.post(this.config.decisionPath, {
      scope: tenantScope(input.tenantId, input.userId),
      subjectType: input.subjectType,
      subjectId: input.subjectId ?? null,
      decision: input.decision,
      rationale: input.rationale ?? null,
      metadata: input.metadata ?? null,
      capturedAt: new Date().toISOString(),
    });
    return { ok: true };
  }

  async consolidate(input: TenantBrainMaintenanceInput) {
    const res = await this.post(this.config.consolidatePath, {
      scope: tenantScope(input.tenantId, input.userId),
      reason: input.reason ?? "scheduled_memory_maintenance",
      requestedAt: new Date().toISOString(),
    });
    return { ok: res.ok !== false, skipped: res.skipped === true };
  }

  async health(): Promise<TenantBrainHealth> {
    try {
      await this.request(this.config.healthPath, { method: "GET" });
      return { ok: true, provider: "gbrain-http", configured: true };
    } catch (e) {
      return {
        ok: false,
        provider: "gbrain-http",
        configured: true,
        error: e instanceof Error ? e.message : "GBrain health check failed.",
      };
    }
  }

  private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    return this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async request(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const url = new URL(path, this.config.baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const headers = new Headers(init.headers);
      if (this.config.apiKey) headers.set("Authorization", `Bearer ${this.config.apiKey}`);
      const res = await fetch(url, { ...init, headers, signal: controller.signal });
      const text = await res.text();
      const json = text ? safeJson(text) : {};
      if (!res.ok) {
        const message = stringFrom(json.error) ?? stringFrom(json.message) ?? res.statusText;
        throw new Error(`GBrain ${url.pathname} failed (${res.status}): ${message}`);
      }
      return json;
    } finally {
      clearTimeout(timeout);
    }
  }
}

let singleton: TenantBrain | null = null;

export function getTenantBrain(): TenantBrain {
  if (singleton) return singleton;
  const baseUrl = process.env.GBRAIN_BASE_URL?.trim();
  if (!baseUrl) {
    singleton = new DisabledTenantBrain();
    return singleton;
  }

  singleton = new GBrainHttpTenantBrain({
    baseUrl,
    apiKey: process.env.GBRAIN_API_KEY?.trim() || null,
    ingestPath: process.env.GBRAIN_INGEST_PATH?.trim() || "/api/memory/ingest",
    queryPath: process.env.GBRAIN_QUERY_PATH?.trim() || "/api/memory/query",
    gapsPath: process.env.GBRAIN_GAPS_PATH?.trim() || "/api/memory/gaps",
    decisionPath: process.env.GBRAIN_DECISION_PATH?.trim() || "/api/memory/decisions",
    consolidatePath: process.env.GBRAIN_CONSOLIDATE_PATH?.trim() || "/api/memory/consolidate",
    healthPath: process.env.GBRAIN_HEALTH_PATH?.trim() || "/health",
    timeoutMs: Number(process.env.GBRAIN_TIMEOUT_MS || 3500),
  });
  return singleton;
}

export function __resetTenantBrainForTests() {
  singleton = null;
}

function tenantScope(tenantId: string, userId?: string | null) {
  return {
    tenantId,
    userId: userId ?? null,
    namespace: `tenant:${tenantId}`,
  };
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { message: text };
  }
}

function normalizeMemory(raw: unknown): TenantBrainMemory | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = stringFrom(obj.id) ?? stringFrom(obj.memoryId) ?? crypto.randomUUID();
  const title = stringFrom(obj.title) ?? stringFrom(obj.name) ?? stringFrom(obj.source) ?? "Tenant memory";
  const content =
    stringFrom(obj.content) ??
    stringFrom(obj.text) ??
    stringFrom(obj.summary) ??
    stringFrom(obj.body) ??
    "";
  if (!content.trim()) return null;
  return {
    id,
    title,
    content: content.trim(),
    source: stringFrom(obj.source),
    subjectType: stringFrom(obj.subjectType),
    subjectId: stringFrom(obj.subjectId),
    score: typeof obj.score === "number" ? obj.score : undefined,
    metadata: obj.metadata && typeof obj.metadata === "object" ? (obj.metadata as Record<string, unknown>) : undefined,
  };
}

function normalizeGap(raw: unknown, fallbackSeverity: TenantBrainGap["severity"]): TenantBrainGap | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const title =
    stringFrom(obj.title) ??
    stringFrom(obj.name) ??
    stringFrom(obj.subject) ??
    "Memory gap";
  const detail =
    stringFrom(obj.detail) ??
    stringFrom(obj.description) ??
    stringFrom(obj.reason) ??
    stringFrom(obj.content) ??
    stringFrom(obj.summary) ??
    "";
  if (!detail.trim()) return null;
  return {
    id: stringFrom(obj.id) ?? stringFrom(obj.gapId) ?? crypto.randomUUID(),
    title,
    detail: detail.trim(),
    severity: severityFrom(obj.severity) ?? fallbackSeverity,
    subjectType: stringFrom(obj.subjectType) ?? stringFrom(obj.type),
    subjectId: stringFrom(obj.subjectId),
    source: stringFrom(obj.source),
    staleSince: stringFrom(obj.staleSince) ?? stringFrom(obj.updatedAt),
    metadata: obj.metadata && typeof obj.metadata === "object" ? (obj.metadata as Record<string, unknown>) : undefined,
  };
}

function gapMemories(gaps: TenantBrainGap[]): TenantBrainMemory[] {
  return gaps.map((gap) => ({
    id: gap.id,
    title: gap.title,
    content: gap.detail,
    source: gap.source,
    subjectType: gap.subjectType,
    subjectId: gap.subjectId,
    metadata: gap.metadata,
  }));
}

function citationsFrom(memories: TenantBrainMemory[]) {
  return memories
    .map((m) => m.source || [m.subjectType, m.subjectId].filter(Boolean).join(":") || m.title)
    .filter((value, idx, all) => value && all.indexOf(value) === idx)
    .slice(0, 8);
}

function severityFrom(value: unknown): TenantBrainGap["severity"] | undefined {
  if (value === "info" || value === "warning" || value === "critical") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "low") return "info";
  if (normalized === "medium" || normalized === "high") return "warning";
  if (normalized === "urgent" || normalized === "blocker") return "critical";
  return undefined;
}

function numberFrom(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringFrom(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
