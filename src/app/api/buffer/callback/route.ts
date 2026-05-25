import { NextResponse } from "next/server";
import {
  exchangeBufferCode,
  getBufferRedirectUri,
  storeBufferTokens,
  verifyBufferState,
} from "@/lib/buffer";
import { canEditBrokerageConfig } from "@/lib/ops/auth";
import { requireTenantUser } from "@/lib/session-guard";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const settingsUrl = new URL("/settings", req.url);
  const error = url.searchParams.get("error");
  if (error) {
    settingsUrl.searchParams.set("error", "buffer-oauth");
    settingsUrl.searchParams.set("detail", url.searchParams.get("error_description") || error);
    return NextResponse.redirect(settingsUrl);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    settingsUrl.searchParams.set("error", "buffer-oauth");
    settingsUrl.searchParams.set("detail", "Buffer did not return an authorization code.");
    return NextResponse.redirect(settingsUrl);
  }

  const user = await requireTenantUser().catch(() => null);
  if (!user || !canEditBrokerageConfig(user.role)) {
    settingsUrl.searchParams.set("error", "buffer-forbidden");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const payload = verifyBufferState(state);
    if (payload.userId !== user.id || payload.tenantId !== user.tenantId) {
      throw new Error("Buffer OAuth state does not match the current brokerage session.");
    }
    const token = await exchangeBufferCode({
      code,
      redirectUri: getBufferRedirectUri(url.origin),
    });
    await storeBufferTokens({ tenantId: user.tenantId, token });
    settingsUrl.searchParams.set("saved", "buffer-connected");
    return NextResponse.redirect(settingsUrl);
  } catch (err) {
    settingsUrl.searchParams.set("error", "buffer-oauth");
    settingsUrl.searchParams.set("detail", err instanceof Error ? err.message : "Buffer OAuth failed.");
    return NextResponse.redirect(settingsUrl);
  }
}
