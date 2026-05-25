import { NextResponse } from "next/server";
import { MarketingAssetType } from "@prisma/client";
import { generateMarketingAsset } from "@/lib/ops/workflows";
import { authzResponse, requireTenantUser } from "@/lib/session-guard";

export async function POST(req: Request) {
  let user;
  try {
    user = await requireTenantUser();
  } catch (error) {
    return authzResponse(error);
  }

  const body = (await req.json().catch(() => null)) as
    | {
        title?: string;
        type?: MarketingAssetType;
        content?: string;
        listingId?: string | null;
        contactId?: string | null;
        metadata?: unknown;
      }
    | null;
  if (!body?.title || !body.type) {
    return NextResponse.json({ error: "title and type required" }, { status: 400 });
  }

  const asset = await generateMarketingAsset({
    actor: {
      id: user.id,
      tenantId: user.tenantId,
      role: user.role,
    },
    title: body.title,
    type: body.type,
    content: body.content ?? null,
    listingId: body.listingId ?? null,
    contactId: body.contactId ?? null,
    metadata: body.metadata as never,
  });

  return NextResponse.json({ asset });
}
