import { NextResponse } from "next/server";
import { getTenantBrain } from "@/lib/tenant-brain";
import { checkEnvironment } from "@/lib/env";
import { prisma } from "@/lib/prisma";

type HealthCheck = {
  name: string;
  ok: boolean;
  status: "ok" | "degraded" | "down";
  detail?: string;
  metadata?: Record<string, unknown>;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const deep = url.searchParams.get("deep") === "1" || url.searchParams.get("deep") === "true";
  const checks: HealthCheck[] = [];
  const env = checkEnvironment();

  checks.push({
    name: "environment",
    ok: env.ok,
    status: env.ok ? "ok" : "down",
    metadata: {
      missingRequired: env.checks.filter((c) => c.required && !c.ok).map((c) => c.name),
      optionalMissing: env.checks.filter((c) => !c.required && !c.ok).map((c) => c.name),
    },
  });

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ name: "database", ok: true, status: "ok" });
  } catch (error) {
    checks.push({
      name: "database",
      ok: false,
      status: "down",
      detail: error instanceof Error ? error.message : "Database check failed.",
    });
  }

  if (deep) {
    const brain = await getTenantBrain().health();
    checks.push({
      name: "tenant_brain",
      ok: brain.ok,
      status: brain.ok ? (brain.configured ? "ok" : "degraded") : "down",
      detail: brain.error,
      metadata: { provider: brain.provider, configured: brain.configured },
    });

    const recentFailedJobs = await prisma.jobRun.count({
      where: {
        status: "FAILED",
        startedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    checks.push({
      name: "jobs",
      ok: recentFailedJobs === 0,
      status: recentFailedJobs === 0 ? "ok" : "degraded",
      metadata: { failedLast24h: recentFailedJobs },
    });

    const degradedChannels = await prisma.channelAccount.count({
      where: { status: { in: ["degraded", "failed"] } },
    });
    const tenantBufferConnections = await prisma.bufferTokens.count();
    checks.push({
      name: "channels",
      ok: degradedChannels === 0,
      status: degradedChannels === 0 ? "ok" : "degraded",
      metadata: {
        degradedChannels,
        telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
        bufferConfigured: tenantBufferConnections > 0 || Boolean(process.env.BUFFER_ACCESS_TOKEN?.trim()),
        tenantBufferConnections,
        hubspotConfigured: Boolean(
          process.env.HUBSPOT_CLIENT_ID?.trim() && process.env.HUBSPOT_CLIENT_SECRET?.trim()
        ),
      },
    });
  }

  const down = checks.some((check) => check.status === "down");
  const degraded = checks.some((check) => check.status === "degraded");
  const status = down ? "down" : degraded ? "degraded" : "ok";

  return NextResponse.json(
    {
      ok: status !== "down",
      status,
      service: "re-agent-os",
      deep,
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: status === "down" ? 503 : 200 }
  );
}
