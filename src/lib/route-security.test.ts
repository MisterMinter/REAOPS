import assert from "node:assert/strict";
import test from "node:test";
import { requireRouteSecret } from "@/lib/route-security";

test("route secret fails closed in production when unset", () => {
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.TEST_ROUTE_SECRET;
  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV = "production";
  delete process.env.TEST_ROUTE_SECRET;
  try {
    const res = requireRouteSecret(new Request("https://reaops.test/api/cron"), "TEST_ROUTE_SECRET");
    assert.equal(res?.status, 503);
  } finally {
    env.NODE_ENV = prevEnv;
    if (prevSecret == null) delete process.env.TEST_ROUTE_SECRET;
    else process.env.TEST_ROUTE_SECRET = prevSecret;
  }
});

test("route secret accepts bearer token and rejects mismatches", () => {
  const prevSecret = process.env.TEST_ROUTE_SECRET;
  process.env.TEST_ROUTE_SECRET = "expected-secret";
  try {
    const ok = requireRouteSecret(
      new Request("https://reaops.test/api/cron", {
        headers: { authorization: "Bearer expected-secret" },
      }),
      "TEST_ROUTE_SECRET"
    );
    assert.equal(ok, null);

    const denied = requireRouteSecret(
      new Request("https://reaops.test/api/cron?secret=wrong"),
      "TEST_ROUTE_SECRET"
    );
    assert.equal(denied?.status, 401);
  } finally {
    if (prevSecret == null) delete process.env.TEST_ROUTE_SECRET;
    else process.env.TEST_ROUTE_SECRET = prevSecret;
  }
});
