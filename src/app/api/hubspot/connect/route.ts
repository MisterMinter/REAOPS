import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildHubSpotInstallUrl, HubSpotError } from "@/lib/hubspot";
import { canEditBrokerageConfig } from "@/lib/ops/auth";

export async function GET(req: Request) {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.tenantId || !canEditBrokerageConfig(user.role)) {
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
