import { NextRequest, NextResponse } from "next/server";
import { runEnabledAgentLoops } from "@/lib/agent-loops/runner";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const url = new URL(req.url);
    const token =
      url.searchParams.get("secret") ??
      req.headers.get("authorization")?.replace("Bearer ", "");
    if (token !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const results: {
    tenant: string;
    runs: { id: string; kind: string; actionsCreated: number }[];
    error?: string;
  }[] = [];

  for (const tenant of tenants) {
    try {
      const runs = await runEnabledAgentLoops({
        tenantId: tenant.id,
        trigger: "cron",
        respectCadence: true,
      });
      results.push({
        tenant: tenant.name,
        runs: runs.map((run) => ({
          id: run.runId,
          kind: run.kind,
          actionsCreated: run.actions.length,
        })),
      });
    } catch (e) {
      console.error(`[agent-loops-cron] Failed for tenant ${tenant.name}:`, e);
      results.push({
        tenant: tenant.name,
        runs: [],
        error: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    tenants: results,
    timestamp: new Date().toISOString(),
  });
}
