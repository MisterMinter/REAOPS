import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRouteSecret } from "@/lib/route-security";
import {
  backfillTenantBrain,
  maintainTenantBrain,
} from "@/lib/tenant-brain/ops";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const unauthorized = requireRouteSecret(req, "CRON_SECRET");
  if (unauthorized) return unauthorized;

  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const results: {
    tenant: string;
    backfillJobRunId?: string;
    maintenanceJobRunId?: string;
    backfillSkipped?: boolean;
    maintenanceSkipped?: boolean;
    error?: string;
  }[] = [];

  for (const tenant of tenants) {
    try {
      const backfill = await backfillTenantBrain({
        prisma,
        tenantId: tenant.id,
        trigger: "cron",
        reason: "scheduled_memory_backfill",
      });
      const maintenance = await maintainTenantBrain({
        prisma,
        tenantId: tenant.id,
        trigger: "cron",
        reason: "scheduled_memory_maintenance",
      });

      results.push({
        tenant: tenant.name,
        backfillJobRunId: backfill.jobRunId,
        maintenanceJobRunId: maintenance.jobRunId,
        backfillSkipped: backfill.status === "skipped",
        maintenanceSkipped: maintenance.status === "skipped",
      });
    } catch (e) {
      console.error(`[tenant-brain-cron] Failed for tenant ${tenant.name}:`, e);
      results.push({
        tenant: tenant.name,
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
