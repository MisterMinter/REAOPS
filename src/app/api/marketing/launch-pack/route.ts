import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { ListingFacts } from "@/lib/marketing-generate";
import { createListingLaunchPack } from "@/lib/marketing/launch-pack";

type Body = {
  sourceListingKey?: string;
  cachedListingId?: string | null;
  driveFolderId?: string | null;
  facts?: ListingFacts;
  goal?: string;
  heroContext?: string | null;
  photoNames?: string[];
  provider?: string | null;
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json({ error: "Tenant required" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.facts?.address || !body.sourceListingKey) {
    return NextResponse.json(
      { error: "sourceListingKey and listing facts are required" },
      { status: 400 }
    );
  }

  const campaign = await createListingLaunchPack({
    actor: {
      id: session.user.id,
      tenantId: session.user.tenantId,
      role: session.user.role,
    },
    sourceListingKey: body.sourceListingKey,
    cachedListingId: body.cachedListingId ?? null,
    driveFolderId: body.driveFolderId ?? null,
    facts: body.facts,
    goal: body.goal ?? "listing_launch",
    heroContext: body.heroContext ?? null,
    photoNames: body.photoNames ?? [],
    provider: body.provider ?? null,
  });

  return NextResponse.json({ campaign });
}
