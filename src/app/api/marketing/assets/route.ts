import { NextResponse } from "next/server";
import { MarketingAssetType } from "@prisma/client";
import { auth } from "@/auth";
import { generateMarketingAsset } from "@/lib/ops/workflows";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json({ error: "Tenant required" }, { status: 403 });
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
      id: session.user.id,
      tenantId: session.user.tenantId,
      role: session.user.role,
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
