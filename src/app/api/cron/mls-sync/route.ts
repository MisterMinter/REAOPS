import { NextRequest, NextResponse } from "next/server";
import { withJobRun } from "@/lib/jobs";
import { syncTenantMlsProviders } from "@/lib/mls/sync";
import { prisma } from "@/lib/prisma";
import { requireRouteSecret } from "@/lib/route-security";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const unauthorized = requireRouteSecret(req, "CRON_SECRET");
  if (unauthorized) return unauthorized;

  const tenants = await prisma.tenant.findMany({
    where: {
      isActive: true,
      mlsProviderConfigs: { some: { enabled: true } },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const results: {
    tenant: string;
    jobRunId?: string;
    skipped?: boolean;
    imported?: number;
    upserted?: number;
    providersSynced?: number;
    errors?: string[];
    error?: string;
  }[] = [];

  for (const tenant of tenants) {
    try {
      const job = await withJobRun({
        prisma,
        tenantId: tenant.id,
        kind: "mls_sync",
        key: `mls-sync:${tenant.id}`,
        trigger: "cron",
        ttlMs: 45 * 60 * 1000,
        metadata: { tenantName: tenant.name },
        summarize: (result) =>
          `Synced ${result.providersSynced} MLS provider(s), upserted ${result.upserted} listing(s).`,
        resultMetadata: (result) => ({
          tenantName: tenant.name,
          providersChecked: result.providersChecked,
          providersSynced: result.providersSynced,
          imported: result.imported,
          upserted: result.upserted,
          errors: result.errors.slice(0, 10),
        }),
        run: async () => syncTenantMlsProviders({ prisma, tenantId: tenant.id }),
      });

      results.push(
        job.status === "skipped"
          ? {
              tenant: tenant.name,
              jobRunId: job.jobRunId,
              skipped: true,
              error: "Skipped because another MLS sync is active.",
            }
          : {
              tenant: tenant.name,
              jobRunId: job.jobRunId,
              imported: job.result.imported,
              upserted: job.result.upserted,
              providersSynced: job.result.providersSynced,
              errors: job.result.errors,
            }
      );
    } catch (error) {
      console.error(`[mls-sync-cron] Failed for tenant ${tenant.name}:`, error);
      results.push({
        tenant: tenant.name,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    tenants: results,
    timestamp: new Date().toISOString(),
  });
}
