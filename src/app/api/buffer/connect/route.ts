import { NextResponse } from "next/server";
import { buildBufferInstallUrl, BufferError } from "@/lib/buffer";
import { canEditBrokerageConfig } from "@/lib/ops/auth";
import { requireTenantUser } from "@/lib/session-guard";

export async function GET(req: Request) {
  const user = await requireTenantUser().catch(() => null);
  if (!user || !canEditBrokerageConfig(user.role)) {
    return NextResponse.redirect(new URL("/settings?error=buffer-forbidden", req.url));
  }

  try {
    return NextResponse.redirect(
      buildBufferInstallUrl({
        tenantId: user.tenantId,
        userId: user.id,
        origin: new URL(req.url).origin,
      })
    );
  } catch (error) {
    const redirect = new URL("/settings", req.url);
    redirect.searchParams.set("error", "buffer-config");
    redirect.searchParams.set("detail", error instanceof BufferError ? error.message : "Buffer connect is not configured.");
    return NextResponse.redirect(redirect);
  }
}
