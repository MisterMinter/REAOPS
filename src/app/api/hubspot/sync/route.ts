import { NextResponse } from "next/server";
import { syncHubSpotForTenant } from "@/lib/hubspot";
import { canEditBrokerageConfig } from "@/lib/ops/auth";
import { authzResponse, requireTenantUser } from "@/lib/session-guard";

export async function POST() {
  let user;
  try {
    user = await requireTenantUser();
  } catch (error) {
    return authzResponse(error);
  }
  if (!canEditBrokerageConfig(user.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const summary = await syncHubSpotForTenant({
      tenantId: user.tenantId,
      actorId: user.id,
    });
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "HubSpot sync failed." },
      { status: 500 }
    );
  }
}
