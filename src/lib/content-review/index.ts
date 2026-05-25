import type { Prisma, PrismaClient } from "@prisma/client";
import { generateObject } from "ai";
import { z } from "zod";
import { resolveLanguageModel } from "@/lib/ai-chat";
import { parseBrandKit } from "@/lib/marketing/brand-kit";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { getTenantBrain } from "@/lib/tenant-brain";

export type ContentReviewStatus = "PASS" | "BLOCK" | "NEEDS_HUMAN";

export type ContentReviewKind =
  | "EMAIL"
  | "TEXT"
  | "SOCIAL_POST"
  | "MLS_COPY"
  | "FLYER"
  | "DRIVE_DOC"
  | "MARKETING_ASSET";

export type ContentReviewFacts = {
  address?: string | null;
  priceDisplay?: string | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  status?: string | null;
  features?: string | null;
};

export type ContentReviewInput = {
  prisma?: PrismaClient;
  tenantId: string;
  actorId?: string | null;
  kind: ContentReviewKind;
  title?: string | null;
  subject?: string | null;
  content: string;
  facts?: ContentReviewFacts | null;
  metadata?: Prisma.InputJsonValue;
};

export type ContentReviewResult = {
  status: ContentReviewStatus;
  reasons: string[];
  suggestedRevisions: string[];
  confidence: number;
  checkedAt: string;
  reviewer: "layered" | "rules" | "ai";
  citations: string[];
  layers: ContentReviewLayer[];
};

export type ContentReviewLayer = {
  name: "deterministic_rules" | "tenant_brand" | "gbrain_memory" | "source_facts" | "ai_review";
  status: ContentReviewStatus;
  reasons: string[];
  suggestedRevisions?: string[];
  citations?: string[];
  degraded?: boolean;
};

const STATUS_RANK: Record<ContentReviewStatus, number> = {
  PASS: 0,
  NEEDS_HUMAN: 1,
  BLOCK: 2,
};

const BLOCK_PHRASES = [
  { pattern: /\bperfect for (families|kids|children|seniors|empty nesters|young professionals)\b/i, reason: "Fair-housing-sensitive audience targeting." },
  { pattern: /\bfamily[- ]friendly\b/i, reason: "Fair-housing-sensitive audience targeting." },
  { pattern: /\bsafe (area|neighborhood|street|community)\b/i, reason: "Unsupported safety claim." },
  { pattern: /\bcrime[- ]free\b/i, reason: "Unsupported safety claim." },
  { pattern: /\bbest schools?\b/i, reason: "Potentially unsupported school-quality claim." },
  { pattern: /\bexclusive (neighborhood|community)\b/i, reason: "Potentially exclusionary housing language." },
  { pattern: /\bguaranteed\b/i, reason: "Unsupported guarantee." },
  { pattern: /\bno[- ]risk\b/i, reason: "Unsupported guarantee." },
  { pattern: /\bwill appreciate\b/i, reason: "Unsupported investment performance claim." },
  { pattern: /\blegal advice\b/i, reason: "Legal-advice language is not allowed." },
];

const REVIEW_PHRASES = [
  { pattern: /\bact now\b/i, reason: "High-pressure language conflicts with the brokerage tone." },
  { pattern: /\bwon'?t last\b/i, reason: "High-pressure language may need broker review." },
  { pattern: /\bonce[- ]in[- ]a[- ]lifetime\b/i, reason: "Overstated marketing language may need review." },
  { pattern: /\boffer\b/i, reason: "Offer language requires human review." },
  { pattern: /\bcounteroffer\b/i, reason: "Counteroffer language requires human review." },
  { pattern: /\bdeadline\b/i, reason: "Deadline language requires human review." },
  { pattern: /\bcontract\b/i, reason: "Contract language requires human review." },
  { pattern: /\battorney\b/i, reason: "Legal-sensitive language requires human review." },
];

const aiReviewSchema = z.object({
  status: z.enum(["PASS", "BLOCK", "NEEDS_HUMAN"]),
  reasons: z.array(z.string()).max(8),
  suggestedRevisions: z.array(z.string()).max(8),
  confidence: z.number().min(0).max(1),
});

export async function reviewContent(input: ContentReviewInput): Promise<ContentReviewResult> {
  const prisma = input.prisma ?? defaultPrisma;
  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: {
      defaultTone: true,
      brandKit: true,
      complianceStandard: true,
    },
  });
  const brandKit = parseBrandKit(tenant?.brandKit);
  const text = [input.subject, input.title, input.content].filter(Boolean).join("\n");
  const layers: ContentReviewLayer[] = [];

  const rulesReasons: string[] = [];
  const rulesRevisions: string[] = [];
  let rulesStatus: ContentReviewStatus = "PASS";
  for (const check of BLOCK_PHRASES) {
    if (check.pattern.test(text)) {
      rulesStatus = "BLOCK";
      addUnique(rulesReasons, check.reason);
    }
  }

  for (const check of REVIEW_PHRASES) {
    if (check.pattern.test(text)) {
      if (rulesStatus !== "BLOCK") rulesStatus = "NEEDS_HUMAN";
      addUnique(rulesReasons, check.reason);
    }
  }

  if (rulesReasons.length === 0) {
    addUnique(rulesReasons, "No deterministic blocker phrases found.");
  }
  if (rulesReasons.some((r) => /fair-housing|safety|guarantee|investment|legal/i.test(r))) {
    addUnique(rulesRevisions, "Remove unsupported, legal-sensitive, or protected-class-adjacent claims.");
  }
  if (rulesReasons.some((r) => /pressure|overstated|tone/i.test(r))) {
    addUnique(rulesRevisions, "Rewrite with a calm, specific, brokerage-appropriate tone.");
  }
  layers.push({
    name: "deterministic_rules",
    status: rulesStatus,
    reasons: rulesReasons,
    suggestedRevisions: rulesRevisions,
  });

  const brandReasons: string[] = [];
  const brandRevisions: string[] = [];
  let brandStatus: ContentReviewStatus = "PASS";
  if (tenant?.defaultTone?.toLowerCase().includes("no pressure") && /\b(urgent|hurry|act now|won'?t last)\b/i.test(text)) {
    brandStatus = "NEEDS_HUMAN";
    addUnique(brandReasons, "Copy conflicts with the tenant's no-pressure tone.");
    addUnique(brandRevisions, "Rewrite with a calm, specific, brokerage-appropriate tone.");
  }

  if (brandKit.disclaimer && requiresDisclaimer(input.kind) && !containsNormalized(text, brandKit.disclaimer)) {
    if (brandStatus === "PASS") brandStatus = "NEEDS_HUMAN";
    addUnique(brandReasons, "Required brokerage disclaimer is missing.");
    addUnique(brandRevisions, `Add required disclaimer: ${brandKit.disclaimer}`);
  }
  if (brandReasons.length === 0) addUnique(brandReasons, "Tenant brand kit and tone checks passed.");
  layers.push({
    name: "tenant_brand",
    status: brandStatus,
    reasons: brandReasons,
    suggestedRevisions: brandRevisions,
  });

  const factIssues = checkFacts(text, input.facts);
  let factStatus: ContentReviewStatus = "PASS";
  const factReasons: string[] = [];
  for (const issue of factIssues.blockers) {
    factStatus = "BLOCK";
    addUnique(factReasons, issue);
  }
  for (const issue of factIssues.warnings) {
    if (factStatus !== "BLOCK") factStatus = "NEEDS_HUMAN";
    addUnique(factReasons, issue);
  }
  if (factReasons.length === 0) {
    addUnique(
      factReasons,
      input.facts ? "Source facts matched the generated content." : "No source facts were supplied for deterministic matching."
    );
  }
  layers.push({
    name: "source_facts",
    status: factStatus,
    reasons: factReasons,
    suggestedRevisions: factIssues.suggestedRevisions,
  });

  const memoryLayer = await reviewAgainstTenantBrain(input, text);
  layers.push(memoryLayer);

  const aiLayer = await maybeRunAiReview(input, text, layers);
  if (aiLayer) layers.push(aiLayer);

  const status = layers.reduce(
    (current, layer) => (STATUS_RANK[layer.status] > STATUS_RANK[current] ? layer.status : current),
    "PASS" as ContentReviewStatus
  );
  const reasons = unique(layers.flatMap((layer) => layer.reasons)).filter(
    (reason) =>
      status !== "PASS" ||
      !/No deterministic blocker|checks passed|matched|No source facts|GBrain memory is unavailable|No cited GBrain memory|did not add/i.test(reason)
  );
  const suggestedRevisions = unique(layers.flatMap((layer) => layer.suggestedRevisions ?? []));
  const citations = unique(layers.flatMap((layer) => layer.citations ?? []));
  if (status === "PASS") {
    addUnique(reasons, "Content passed brand, factual, and compliance gate.");
  }

  return {
    status,
    reasons,
    suggestedRevisions,
    confidence: confidenceFromLayers(status, layers),
    checkedAt: new Date().toISOString(),
    reviewer: aiLayer ? "ai" : "layered",
    citations,
    layers,
  };
}

export function reviewToJson(review: ContentReviewResult): Prisma.InputJsonValue {
  return {
    status: review.status,
    reasons: review.reasons,
    suggestedRevisions: review.suggestedRevisions,
    confidence: review.confidence,
    checkedAt: review.checkedAt,
    reviewer: review.reviewer,
    citations: review.citations,
    layers: review.layers,
  };
}

export function extractReviewStatus(metadata: unknown): ContentReviewStatus | null {
  if (!metadata || typeof metadata !== "object") return null;
  const review = (metadata as Record<string, unknown>).contentReview;
  if (!review || typeof review !== "object") return null;
  const status = (review as Record<string, unknown>).status;
  return status === "PASS" || status === "BLOCK" || status === "NEEDS_HUMAN" ? status : null;
}

export function mergeMetadataWithReview(
  metadata: Prisma.InputJsonValue | null | undefined,
  review: ContentReviewResult
): Prisma.InputJsonValue {
  const base = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
  return {
    ...base,
    contentReview: reviewToJson(review),
  };
}

function checkFacts(text: string, facts?: ContentReviewFacts | null) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const suggestedRevisions: string[] = [];
  if (!facts) return { blockers, warnings, suggestedRevisions };

  const beds = firstNumber(text, /\b(\d+(?:\.\d+)?)\s*(?:bed|beds|bd|br)\b/i);
  if (beds != null && facts.beds != null && beds !== facts.beds) {
    blockers.push(`Bed count mismatch: copy says ${beds}, source says ${facts.beds}.`);
    suggestedRevisions.push(`Use ${facts.beds} beds from the source listing.`);
  }

  const baths = firstNumber(text, /\b(\d+(?:\.\d+)?)\s*(?:bath|baths|ba)\b/i);
  if (baths != null && facts.baths != null && baths !== facts.baths) {
    blockers.push(`Bath count mismatch: copy says ${baths}, source says ${facts.baths}.`);
    suggestedRevisions.push(`Use ${facts.baths} baths from the source listing.`);
  }

  const sqft = firstNumber(text, /\b([\d,]+)\s*(?:sq\.?\s*ft|sqft|square feet)\b/i);
  if (sqft != null && facts.sqft != null && Math.abs(sqft - facts.sqft) > 25) {
    blockers.push(`Square-footage mismatch: copy says ${sqft}, source says ${facts.sqft}.`);
    suggestedRevisions.push(`Use ${facts.sqft.toLocaleString()} sq ft from the source listing.`);
  }

  const sourcePrice = numberFromPrice(facts.priceDisplay);
  const mentionedPrices = priceMentions(text).filter((price) => price >= 100_000);
  const mismatchedPrice = sourcePrice
    ? mentionedPrices.find((price) => Math.abs(price - sourcePrice) > 1000)
    : null;
  if (mismatchedPrice && sourcePrice) {
    blockers.push(`Price mismatch: copy says ${formatCurrency(mismatchedPrice)}, source says ${formatCurrency(sourcePrice)}.`);
    suggestedRevisions.push(`Use ${formatCurrency(sourcePrice)} from the source listing.`);
  } else if (!sourcePrice && mentionedPrices.length > 0) {
    warnings.push("Copy mentions a price, but no source price is available.");
  }

  return { blockers, warnings, suggestedRevisions };
}

async function reviewAgainstTenantBrain(
  input: ContentReviewInput,
  text: string
): Promise<ContentReviewLayer> {
  try {
    const result = await getTenantBrain().query({
      tenantId: input.tenantId,
      userId: input.actorId ?? null,
      query: [
        `Review guidance for ${input.kind}.`,
        input.title ? `Title: ${input.title}` : "",
        input.subject ? `Subject: ${input.subject}` : "",
        "Return tenant brand direction, SOPs, prohibited language, approval policy, and relevant compliance memory.",
        truncate(text, 1200),
      ]
        .filter(Boolean)
        .join("\n"),
      limit: 5,
      filters: { purpose: "content_review", kind: input.kind },
    });
    if (result.degraded) {
      return {
        name: "gbrain_memory",
        status: "PASS",
        reasons: [result.error ?? "GBrain memory is unavailable; review continued with deterministic layers."],
        citations: [],
        degraded: true,
      };
    }

    const memoryText = result.memories.map((memory) => memory.content).join("\n");
    const reasons: string[] = [];
    const suggestedRevisions: string[] = [];
    let status: ContentReviewStatus = "PASS";

    if (/\b(block|blocked|do not send|never publish|prohibited)\b/i.test(memoryText)) {
      status = "NEEDS_HUMAN";
      addUnique(reasons, "GBrain memory contains restrictive brand/SOP guidance relevant to this content.");
      addUnique(suggestedRevisions, "Compare the content against cited brand/SOP memory before release.");
    }
    if (/\b(require|requires|must have)\s+(broker|human|manager|owner)?\s*(approval|review)\b/i.test(memoryText)) {
      status = "NEEDS_HUMAN";
      addUnique(reasons, "GBrain memory indicates this content class requires human review.");
    }
    if (reasons.length === 0) {
      addUnique(
        reasons,
        result.memories.length > 0
          ? "Cited GBrain memory did not add a blocking constraint."
          : "No cited GBrain memory was returned for this review."
      );
    }

    return {
      name: "gbrain_memory",
      status,
      reasons,
      suggestedRevisions,
      citations: result.citations,
    };
  } catch (e) {
    return {
      name: "gbrain_memory",
      status: "PASS",
      reasons: [e instanceof Error ? e.message : "GBrain memory review failed."],
      citations: [],
      degraded: true,
    };
  }
}

async function maybeRunAiReview(
  input: ContentReviewInput,
  text: string,
  layers: ContentReviewLayer[]
): Promise<ContentReviewLayer | null> {
  if (!aiReviewEnabled()) return null;
  const model = resolveLanguageModel();
  if (!model) {
    return {
      name: "ai_review",
      status: "PASS",
      reasons: ["AI review was enabled but no model provider is configured."],
      degraded: true,
    };
  }
  try {
    const result = await generateObject({
      model,
      schema: aiReviewSchema,
      system:
        "You are a conservative real estate brokerage content reviewer. Classify content as PASS, NEEDS_HUMAN, or BLOCK. BLOCK fair-housing violations, unsupported facts, legal advice, guarantees, and unsafe claims. NEEDS_HUMAN for offer, contract, deadline, legal-sensitive, brand-sensitive, or uncertain content.",
      prompt: [
        `Kind: ${input.kind}`,
        input.title ? `Title: ${input.title}` : "",
        input.subject ? `Subject: ${input.subject}` : "",
        input.facts ? `Source facts: ${JSON.stringify(input.facts)}` : "Source facts: none supplied",
        "Prior layer results:",
        JSON.stringify(layers.map((layer) => ({ name: layer.name, status: layer.status, reasons: layer.reasons })), null, 2),
        "Content:",
        text,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    return {
      name: "ai_review",
      status: result.object.status,
      reasons: result.object.reasons.length > 0 ? result.object.reasons : ["AI review completed."],
      suggestedRevisions: result.object.suggestedRevisions,
    };
  } catch (e) {
    return {
      name: "ai_review",
      status: "PASS",
      reasons: [e instanceof Error ? e.message : "AI review failed."],
      degraded: true,
    };
  }
}

function requiresDisclaimer(kind: ContentReviewKind) {
  return kind === "FLYER" || kind === "DRIVE_DOC" || kind === "MLS_COPY";
}

function containsNormalized(text: string, needle: string) {
  const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(text).includes(norm(needle));
}

function firstNumber(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match) return null;
  const raw = match[1]?.replace(/,/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function priceMentions(text: string) {
  const matches = text.matchAll(/\$([\d,]+)(?:\.(\d{2}))?/g);
  const values: number[] = [];
  for (const match of matches) {
    const n = Number(match[1]?.replace(/,/g, ""));
    if (Number.isFinite(n)) values.push(n);
  }
  return values;
}

function numberFromPrice(raw?: string | null) {
  if (!raw) return null;
  const match = raw.match(/([\d,]+)/);
  if (!match) return null;
  const n = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function formatCurrency(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function addUnique(values: string[], value: string) {
  if (!values.includes(value)) values.push(value);
}

function confidenceFromLayers(status: ContentReviewStatus, layers: ContentReviewLayer[]) {
  if (layers.some((layer) => layer.degraded)) return status === "PASS" ? 0.72 : 0.84;
  if (layers.some((layer) => layer.name === "ai_review")) return status === "PASS" ? 0.88 : 0.92;
  return status === "PASS" ? 0.84 : 0.9;
}

function aiReviewEnabled() {
  const value = process.env.CONTENT_REVIEW_AI?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function truncate(value: string, max: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function unique(values: string[]) {
  return values.filter((value, index, all) => value && all.indexOf(value) === index);
}
