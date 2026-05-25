import test from "node:test";
import assert from "node:assert/strict";
import { __resetTenantBrainForTests, getTenantBrain } from "@/lib/tenant-brain";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
  __resetTenantBrainForTests();
});

test("disabled tenant brain is safe and returns degraded empty memory", async () => {
  delete process.env.GBRAIN_BASE_URL;
  const brain = getTenantBrain();

  const health = await brain.health();
  const result = await brain.query({ tenantId: "tenant_a", query: "What changed?" });
  const gaps = await brain.gaps({ tenantId: "tenant_a" });
  const maintenance = await brain.consolidate({ tenantId: "tenant_a" });

  assert.equal(health.configured, false);
  assert.deepEqual(result.memories, []);
  assert.equal(result.degraded, true);
  assert.deepEqual(gaps.gaps, []);
  assert.equal(gaps.degraded, true);
  assert.equal(maintenance.skipped, true);
});

test("GBrain client scopes every query by tenant namespace", async () => {
  process.env.GBRAIN_BASE_URL = "https://gbrain.example";
  process.env.GBRAIN_QUERY_PATH = "/query";
  process.env.GBRAIN_API_KEY = "secret";
  const bodies: unknown[] = [];
  const authHeaders: string[] = [];

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    authHeaders.push(new Headers(init?.headers).get("authorization") ?? "");
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(
      JSON.stringify({
        memories: [{ id: "m1", title: "Listing note", content: "123 Main is active.", source: "test" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  const brain = getTenantBrain();
  await brain.query({ tenantId: "tenant_a", userId: "user_1", query: "active listings" });
  await brain.query({ tenantId: "tenant_b", userId: "user_2", query: "active listings" });

  assert.equal(authHeaders[0], "Bearer secret");
  assert.deepEqual((bodies[0] as Record<string, unknown>).scope, {
    tenantId: "tenant_a",
    userId: "user_1",
    namespace: "tenant:tenant_a",
  });
  assert.deepEqual((bodies[1] as Record<string, unknown>).scope, {
    tenantId: "tenant_b",
    userId: "user_2",
    namespace: "tenant:tenant_b",
  });
});

test("GBrain client scopes gaps and consolidation by tenant namespace", async () => {
  process.env.GBRAIN_BASE_URL = "https://gbrain.example";
  process.env.GBRAIN_GAPS_PATH = "/gaps";
  process.env.GBRAIN_CONSOLIDATE_PATH = "/consolidate";
  const requests: { path: string; body: Record<string, unknown> }[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push({ path: url.pathname, body });
    if (url.pathname === "/gaps") {
      return new Response(
        JSON.stringify({
          gaps: [{ id: "g1", title: "Brand tone", detail: "Tone memory is missing.", severity: "medium", source: "gbrain" }],
          stale: [{ id: "s1", title: "SOP", detail: "SOP summary is stale.", source: "gbrain" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const brain = getTenantBrain();
  const gaps = await brain.gaps({ tenantId: "tenant_a", userId: "user_1" });
  const maintenance = await brain.consolidate({ tenantId: "tenant_a", userId: "user_1" });

  assert.equal(gaps.gaps[0]?.severity, "warning");
  assert.equal(gaps.stale[0]?.title, "SOP");
  assert.equal(maintenance.ok, true);
  assert.equal(requests[0]?.path, "/gaps");
  assert.deepEqual(requests[0]?.body.scope, {
    tenantId: "tenant_a",
    userId: "user_1",
    namespace: "tenant:tenant_a",
  });
  assert.equal(requests[1]?.path, "/consolidate");
  assert.deepEqual(requests[1]?.body.scope, {
    tenantId: "tenant_a",
    userId: "user_1",
    namespace: "tenant:tenant_a",
  });
});
