import assert from "node:assert/strict";
import test from "node:test";
import { checkRateLimit } from "@/lib/rate-limit";

test("rate limiter blocks after fixed-window limit", () => {
  const key = `test:${crypto.randomUUID()}`;
  const first = checkRateLimit(key, { limit: 2, windowMs: 10_000 });
  const second = checkRateLimit(key, { limit: 2, windowMs: 10_000 });
  const third = checkRateLimit(key, { limit: 2, windowMs: 10_000 });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, false);
  assert.equal(third.remaining, 0);
});
