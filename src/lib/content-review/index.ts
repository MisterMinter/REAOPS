import type { Prisma, PrismaClient } from "@prisma/client";
import { parseBrandKit } from "@/lib/marketing/brand-kit";
import { prisma as defaultPrisma } from "@/lib/prisma";

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
  reviewer: "rules";
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
  const reasons: string[] = [];
  const suggestedRevisions: string[] = [];
  let status: ContentReviewStatus = "PASS";

  for (const check of BLOCK_PHRASES) {
    if (check.pattern.test(text)) {
      status = "BLOCK";
      addUnique(reasons, check.reason);
    }
  }

  for (const check of REVIEW_PHRASES) {
    if (check.pattern.test(text)) {
      if (status !== "BLOCK") status = "NEEDS_HUMAN";
      addUnique(reasons, check.reason);
    }
  }

  if (tenant?.defaultTone?.toLowerCase().includes("no pressure") && /\b(urgent|hurry|act now|won'?t last)\b/i.test(text)) {
    if (status !== "BLOCK") status = "NEEDS_HUMAN";
    addUnique(reasons, "Copy conflicts with the tenant's no-pressure tone.");
  }

  if (brandKit.disclaimer && requiresDisclaimer(input.kind) && !containsNormalized(text, brandKit.disclaimer)) {
    if (status === "PASS") status = "NEEDS_HUMAN";
    addUnique(reasons, "Required brokerage disclaimer is missing.");
    addUnique(suggestedRevisions, `Add required disclaimer: ${brandKit.disclaimer}`);
  }

  const factIssues = checkFacts(text, input.facts);
  for (const issue of factIssues.blockers) {
    status = "BLOCK";
    addUnique(reasons, issue);
  }
  for (const issue of factIssues.warnings) {
    if (status !== "BLOCK") status = "NEEDS_HUMAN";
    addUnique(reasons, issue);
  }

  if (reasons.some((r) => /fair-housing|safety|guarantee|investment|legal/i.test(r))) {
    addUnique(suggestedRevisions, "Remove unsupported, legal-sensitive, or protected-class-adjacent claims.");
  }
  if (reasons.some((r) => /pressure|overstated|tone/i.test(r))) {
    addUnique(suggestedRevisions, "Rewrite with a calm, specific, brokerage-appropriate tone.");
  }
  if (factIssues.suggestedRevisions.length > 0) {
    for (const revision of factIssues.suggestedRevisions) addUnique(suggestedRevisions, revision);
  }

  if (status === "PASS") {
    addUnique(reasons, "Content passed brand, factual, and compliance gate.");
  }

  return {
    status,
    reasons,
    suggestedRevisions,
    confidence: status === "PASS" ? 0.82 : 0.9,
    checkedAt: new Date().toISOString(),
    reviewer: "rules",
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
