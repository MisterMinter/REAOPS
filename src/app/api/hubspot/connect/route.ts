import { NextResponse } from "next/server";
import { buildHubSpotInstallUrl, HubSpotError } from "@/lib/hubspot";
import { canEditBrokerageConfig } from "@/lib/ops/auth";
import { requireTenantUser } from "@/lib/session-guard";

export async function GET(req: Request) {
  const user = await requireTenantUser().catch(() => null);
  if (!user || !canEditBrokerageConfig(user.role)) {
    return NextResponse.redirect(new URL("/settings?error=hubspot-forbidden", req.url));
  }

  try {
    const url = buildHubSpotInstallUrl({
      tenantId: user.tenantId,
      userId: user.id,
      origin: new URL(req.url).origin,
    });
    return NextResponse.redirect(url);
  } catch (error) {
    const message = error instanceof HubSpotError ? error.message : "HubSpot connect is not configured.";
    const redirect = new URL("/settings", req.url);
    redirect.searchParams.set("error", "hubspot-config");
    redirect.searchParams.set("detail", message);
    return NextResponse.redirect(redirect);
  }
}
