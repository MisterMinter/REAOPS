import test from "node:test";
import assert from "node:assert/strict";
import { reviewContent } from "@/lib/content-review";
import { __resetTenantBrainForTests } from "@/lib/tenant-brain";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
  __resetTenantBrainForTests();
});

const prisma = {
  tenant: {
    findUnique: async () => ({
      defaultTone: "Warm but professional. First-name basis. No pressure.",
      brandKit: {
        disclaimer: "Information deemed reliable but not guaranteed. Equal Housing Opportunity.",
        fontStyle: "Modern editorial",
        primaryColor: "#1f3a5f",
        secondaryColor: "#f5f7fb",
        accentColor: "#c9a84c",
      },
      complianceStandard: "ga_residential",
    }),
  },
};

test("passes specific social copy that matches source facts", async () => {
  const review = await reviewContent({
    prisma: prisma as never,
    tenantId: "tenant_a",
    kind: "SOCIAL_POST",
    content: "A polished 3 bed, 2 bath home listed at $500,000 with a refreshed kitchen.",
    facts: { beds: 3, baths: 2, priceDisplay: "$500,000" },
  });

  assert.equal(review.status, "PASS");
  assert.ok(review.layers.some((layer) => layer.name === "source_facts"));
});

test("blocks fair-housing and unsupported safety language", async () => {
  const review = await reviewContent({
    prisma: prisma as never,
    tenantId: "tenant_a",
    kind: "SOCIAL_POST",
    content: "A family-friendly home in a safe neighborhood with the best schools.",
  });

  assert.equal(review.status, "BLOCK");
  assert.match(review.reasons.join(" "), /Fair-housing|safety|school/i);
});

test("blocks mismatched source facts", async () => {
  const review = await reviewContent({
    prisma: prisma as never,
    tenantId: "tenant_a",
    kind: "SOCIAL_POST",
    content: "This 4 bed, 2 bath home is listed at $525,000.",
    facts: { beds: 3, baths: 2, priceDisplay: "$500,000" },
  });

  assert.equal(review.status, "BLOCK");
  assert.match(review.reasons.join(" "), /Bed count mismatch|Price mismatch/);
});

test("routes high-risk follow-up language to human review", async () => {
  const review = await reviewContent({
    prisma: prisma as never,
    tenantId: "tenant_a",
    kind: "EMAIL",
    subject: "Offer deadline",
    content: "We need to discuss the offer deadline and contract language today.",
  });

  assert.equal(review.status, "NEEDS_HUMAN");
});

test("requires disclaimer for Drive docs", async () => {
  const review = await reviewContent({
    prisma: prisma as never,
    tenantId: "tenant_a",
    kind: "DRIVE_DOC",
    content: "MLS copy for a great listing.",
  });

  assert.equal(review.status, "NEEDS_HUMAN");
  assert.match(review.reasons.join(" "), /disclaimer/i);
});

test("routes cited GBrain brand memory to human review", async () => {
  process.env.GBRAIN_BASE_URL = "https://gbrain.example";
  process.env.GBRAIN_QUERY_PATH = "/query";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        memories: [
          {
            id: "m1",
            title: "Brand approval SOP",
            content: "Social posts about price improvements require broker approval before publishing.",
            source: "prisma:SopTemplate",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as typeof fetch;

  const review = await reviewContent({
    prisma: prisma as never,
    tenantId: "tenant_a",
    kind: "SOCIAL_POST",
    content: "Price improved at 123 Main. Message us for details.",
  });

  assert.equal(review.status, "NEEDS_HUMAN");
  assert.match(review.reasons.join(" "), /GBrain memory/i);
  assert.deepEqual(review.citations, ["prisma:SopTemplate"]);
});
