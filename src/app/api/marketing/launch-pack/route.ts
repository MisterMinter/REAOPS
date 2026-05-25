import { NextResponse } from "next/server";
import type { ListingFacts } from "@/lib/marketing-generate";
import { createListingLaunchPack } from "@/lib/marketing/launch-pack";
import { isFolderAllowedForTenant } from "@/lib/drive-folder-access";
import { getGoogleAccessTokenForUser } from "@/lib/google-account-token";
import { prisma } from "@/lib/prisma";
import { authzResponse, requireTenantUser } from "@/lib/session-guard";

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
  let user;
  try {
    user = await requireTenantUser();
  } catch (error) {
    return authzResponse(error);
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.facts?.address || !body.sourceListingKey) {
    return NextResponse.json(
      { error: "sourceListingKey and listing facts are required" },
      { status: 400 }
    );
  }

  if (body.cachedListingId) {
    const listing = await prisma.cachedListing.findFirst({
      where: { id: body.cachedListingId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }

  if (body.driveFolderId) {
    const accessToken = await getGoogleAccessTokenForUser(user.id);
    const allowed = await isFolderAllowedForTenant(user.tenantId, body.driveFolderId, {
      accessToken: accessToken ?? undefined,
    });
    if (!allowed) {
      return NextResponse.json({ error: "Drive folder is outside this tenant." }, { status: 403 });
    }
  }

  const campaign = await createListingLaunchPack({
    actor: {
      id: user.id,
      tenantId: user.tenantId,
      role: user.role,
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
