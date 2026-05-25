import type { Prisma } from "@prisma/client";

export type TenantBrainDocument = {
  id: string;
  type: string;
  title: string;
  content: string;
  source: string;
  subjectType?: string;
  subjectId?: string;
  updatedAt?: string;
  metadata?: Prisma.InputJsonValue;
};

export type TenantBrainIngestInput = {
  tenantId: string;
  userId?: string | null;
  documents: TenantBrainDocument[];
  reason?: string;
};

export type TenantBrainQueryInput = {
  tenantId: string;
  userId?: string | null;
  query: string;
  limit?: number;
  filters?: Record<string, unknown>;
};

export type TenantBrainMemory = {
  id: string;
  title: string;
  content: string;
  source?: string;
  subjectType?: string;
  subjectId?: string;
  score?: number;
  metadata?: Record<string, unknown>;
};

export type TenantBrainQueryResult = {
  memories: TenantBrainMemory[];
  citations: string[];
  degraded?: boolean;
  error?: string;
};

export type TenantBrainDecisionInput = {
  tenantId: string;
  userId?: string | null;
  subjectType: string;
  subjectId?: string | null;
  decision: string;
  rationale?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export type TenantBrainHealth = {
  ok: boolean;
  provider: string;
  configured: boolean;
  error?: string;
};

export interface TenantBrain {
  ingest(input: TenantBrainIngestInput): Promise<{ ok: boolean; count: number; error?: string }>;
  query(input: TenantBrainQueryInput): Promise<TenantBrainQueryResult>;
  captureDecision(input: TenantBrainDecisionInput): Promise<{ ok: boolean; error?: string }>;
  health(): Promise<TenantBrainHealth>;
}
