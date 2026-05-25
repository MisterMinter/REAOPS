import assert from "node:assert/strict";
import test from "node:test";
import { checkEnvironment } from "@/lib/env";

test("environment check reports missing production requirements", () => {
  const env = process.env as Record<string, string | undefined>;
  const prevNodeEnv = env.NODE_ENV;
  const prevDb = env.DATABASE_URL;
  const prevAuth = env.AUTH_SECRET;
  env.NODE_ENV = "production";
  delete env.DATABASE_URL;
  delete env.AUTH_SECRET;
  try {
    const result = checkEnvironment();
    assert.equal(result.ok, false);
    const missing = result.checks.filter((c) => c.required && !c.ok).map((c) => c.name);
    assert.ok(missing.includes("DATABASE_URL"));
    assert.ok(missing.includes("AUTH_SECRET"));
  } finally {
    env.NODE_ENV = prevNodeEnv;
    if (prevDb == null) delete env.DATABASE_URL;
    else env.DATABASE_URL = prevDb;
    if (prevAuth == null) delete env.AUTH_SECRET;
    else env.AUTH_SECRET = prevAuth;
  }
});
