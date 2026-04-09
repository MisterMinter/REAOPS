import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncZillowProfileSource } from "@/lib/zillow-sync";

/**
 * POST /api/zillow/sync
 *
 * Trigger a Zillow profile sync. Can sync a single source or all sources for a tenant.
 *
 * Body (JSON):
 *   { "sourceId": "..." }           — sync one source
 *   { "tenantId": "..." }           — sync all sources for a tenant
 *   { "all": true }                 — sync every source in the system
 *   { "secret": "..." }             — optional auth for cron/external triggers
 *
 * Protected by ZILLOW_SYNC_SECRET env var when called externally (e.g. Railway cron).
 * Internal agent tool calls skip auth.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const secret = process.env.ZILLOW_SYNC_SECRET?.trim();
  if (secret && body.secret !== secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const sourceId = typeof body.sourceId === "string" ? body.sourceId : null;
  const tenantId = typeof body.tenantId === "string" ? body.tenantId : null;
  const syncAll = body.all === true;

  let sources: { id: string; profileUrl: string; tenantId: string }[];

  if (sourceId) {
    const src = await prisma.zillowProfileSource.findUnique({ where: { id: sourceId } });
    sources = src ? [src] : [];
  } else if (tenantId) {
    sources = await prisma.zillowProfileSource.findMany({ where: { tenantId } });
  } else if (syncAll) {
    sources = await prisma.zillowProfileSource.findMany();
  } else {
    return NextResponse.json(
      { error: "Provide sourceId, tenantId, or all: true" },
      { status: 400 }
    );
  }

  if (sources.length === 0) {
    return NextResponse.json({ error: "No Zillow sources found" }, { status: 404 });
  }

  console.log(`[zillow-sync-api] Syncing ${sources.length} source(s)`);

  const results = [];
  for (const src of sources) {
    console.log(`[zillow-sync-api] Syncing source ${src.id} (${src.profileUrl})`);
    const result = await syncZillowProfileSource(src.id);
    results.push({
      sourceId: src.id,
      profileUrl: src.profileUrl,
      tenantId: src.tenantId,
      ...result,
    });
  }

  const totalImported = results.reduce((s, r) => s + r.imported, 0);
  const totalDetailed = results.reduce((s, r) => s + r.detailed, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
  const totalDuration = results.reduce((s, r) => s + r.durationMs, 0);

  console.log(
    `[zillow-sync-api] Done: ${totalImported} imported, ${totalDetailed} detailed, ${totalErrors} errors, ${totalDuration}ms total`
  );

  return NextResponse.json({
    synced: results.length,
    totalImported,
    totalDetailed,
    totalErrors,
    totalDurationMs: totalDuration,
    results,
  });
}

/**
 * GET /api/zillow/sync — check sync status for all sources
 */
export async function GET() {
  const sources = await prisma.zillowProfileSource.findMany({
    select: {
      id: true,
      profileUrl: true,
      tenantId: true,
      lastSyncedAt: true,
      lastSyncError: true,
    },
    orderBy: { lastSyncedAt: "desc" },
  });

  return NextResponse.json({ sources });
}
