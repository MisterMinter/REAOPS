import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  exchangeHubSpotCode,
  getHubSpotRedirectUri,
  HubSpotError,
  storeHubSpotTokens,
  syncHubSpotForTenant,
  verifyHubSpotState,
} from "@/lib/hubspot";
import { canEditBrokerageConfig } from "@/lib/ops/auth";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const settingsUrl = new URL("/settings", req.url);
  const error = url.searchParams.get("error");
  if (error) {
    settingsUrl.searchParams.set("error", "hubspot-oauth");
    settingsUrl.searchParams.set("detail", url.searchParams.get("error_description") || error);
    return NextResponse.redirect(settingsUrl);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    settingsUrl.searchParams.set("error", "hubspot-oauth");
    settingsUrl.searchParams.set("detail", "HubSpot did not return an authorization code.");
    return NextResponse.redirect(settingsUrl);
  }

  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.tenantId || !canEditBrokerageConfig(user.role)) {
    settingsUrl.searchParams.set("error", "hubspot-forbidden");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const payload = verifyHubSpotState(state);
    if (payload.userId !== user.id || payload.tenantId !== user.tenantId) {
      throw new HubSpotError("HubSpot OAuth state does not match the current brokerage session.");
    }
    const token = await exchangeHubSpotCode({
      code,
      redirectUri: getHubSpotRedirectUri(url.origin),
    });
    await storeHubSpotTokens({ tenantId: user.tenantId, token });
    const summary = await syncHubSpotForTenant({
      tenantId: user.tenantId,
      actorId: user.id,
    });
    settingsUrl.searchParams.set("saved", "hubspot-connected");
    settingsUrl.searchParams.set("contacts", String(summary.contactsImported));
    settingsUrl.searchParams.set("listings", String(summary.listingsImported));
    return NextResponse.redirect(settingsUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "HubSpot OAuth failed.";
    settingsUrl.searchParams.set("error", "hubspot-oauth");
    settingsUrl.searchParams.set("detail", message);
    return NextResponse.redirect(settingsUrl);
  }
}
