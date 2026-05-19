import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncHubSpotForTenant } from "@/lib/hubspot";
import { canEditBrokerageConfig } from "@/lib/ops/auth";

export async function POST() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.tenantId || !canEditBrokerageConfig(user.role)) {
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
