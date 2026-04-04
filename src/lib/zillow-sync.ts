import { prisma } from "@/lib/prisma";
import { fetchZillowProfileHtml, parseZillowListingHints } from "@/lib/zillow-scrape";

export async function syncZillowProfileSource(sourceId: string): Promise<{ imported: number; error?: string }> {
  const src = await prisma.zillowProfileSource.findUnique({ where: { id: sourceId } });
  if (!src) return { imported: 0, error: "not_found" };

  try {
    const html = await fetchZillowProfileHtml(src.profileUrl);
    const hints = parseZillowListingHints(html);
    const now = new Date();

    for (const h of hints) {
      const hubspotId = `zillow:${h.zpid}`;
      const addr = h.addressGuess.slice(0, 500);
      const short = addr.slice(0, 120);

      await prisma.cachedListing.upsert({
        where: { tenantId_hubspotId: { tenantId: src.tenantId, hubspotId } },
        create: {
          tenantId: src.tenantId,
          hubspotId,
          address: addr,
          shortAddress: short,
          city: "",
          state: "",
          zip: null,
          beds: null,
          baths: null,
          sqft: null,
          price: null,
          priceDisplay: "—",
          status: "ZILLOW",
          daysOnMarket: null,
          features: null,
          notes: null,
          mlsNumber: null,
          driveFolderId: null,
          rawData: {
            source: "zillow",
            listingUrl: h.listingUrl,
            zpid: h.zpid,
            profileUrl: src.profileUrl,
          },
          lastSyncedAt: now,
        },
        update: {
          address: addr,
          shortAddress: short,
          rawData: {
            source: "zillow",
            listingUrl: h.listingUrl,
            zpid: h.zpid,
            profileUrl: src.profileUrl,
          },
          lastSyncedAt: now,
        },
      });
    }

    await prisma.zillowProfileSource.update({
      where: { id: sourceId },
      data: {
        lastSyncedAt: now,
        lastSyncError: hints.length ? null : "No listing links found (Zillow HTML may have changed).",
      },
    });

    return { imported: hints.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sync failed";
    await prisma.zillowProfileSource.update({
      where: { id: sourceId },
      data: { lastSyncError: msg },
    });
    return { imported: 0, error: msg };
  }
}
