import { prisma } from "@/lib/prisma";
import {
  scrapeZillowProfile,
  scrapeZillowListingDetail,
  fetchZillowProfileHtml,
  parseZillowListingHints,
  type ZillowProfileListing,
  type ZillowListingDetail,
} from "@/lib/zillow-scrape";

function parsePrice(display: string): number | null {
  const clean = display.replace(/[^0-9.]/g, "");
  const n = parseInt(clean, 10);
  return isNaN(n) ? null : n;
}

function shortAddr(full: string): string {
  const comma = full.indexOf(",");
  return comma > 0 ? full.slice(0, comma).trim() : full.slice(0, 120);
}

export type SyncResult = {
  imported: number;
  detailed: number;
  error?: string;
};

/**
 * Sync a Zillow profile source using Firecrawl structured extract.
 * 1. Scrape profile page → get active + sold + rental listings with basic info
 * 2. Upsert each listing into CachedListing with profile-level data
 * 3. For active listings, scrape individual listing pages for rich detail
 */
export async function syncZillowProfileSource(sourceId: string): Promise<SyncResult> {
  const src = await prisma.zillowProfileSource.findUnique({ where: { id: sourceId } });
  if (!src) return { imported: 0, detailed: 0, error: "not_found" };

  const useFirecrawl = Boolean(process.env.FIRECRAWL_API_KEY?.trim());

  try {
    if (useFirecrawl) {
      return await syncViaFirecrawl(src.id, src.tenantId, src.profileUrl);
    }
    return await syncViaHtmlFallback(src.id, src.tenantId, src.profileUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sync failed";
    await prisma.zillowProfileSource.update({
      where: { id: sourceId },
      data: { lastSyncError: msg },
    });
    return { imported: 0, detailed: 0, error: msg };
  }
}

async function syncViaFirecrawl(
  sourceId: string,
  tenantId: string,
  profileUrl: string
): Promise<SyncResult> {
  const profile = await scrapeZillowProfile(profileUrl);
  const now = new Date();

  const allListings = [
    ...profile.activeListings,
    ...profile.soldListings,
    ...profile.rentals,
  ];

  for (const listing of allListings) {
    await upsertFromProfile(tenantId, listing, profileUrl, now);
  }

  let detailed = 0;
  for (const listing of profile.activeListings) {
    if (!listing.listingUrl) continue;
    try {
      const detail = await scrapeZillowListingDetail(listing.listingUrl);
      await enrichWithDetail(tenantId, listing.zpid, detail, now);
      detailed++;
    } catch (e) {
      console.warn(
        `Detail scrape failed for ${listing.address}:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  await prisma.zillowProfileSource.update({
    where: { id: sourceId },
    data: {
      lastSyncedAt: now,
      lastSyncError: allListings.length
        ? null
        : "No listings found on profile page.",
    },
  });

  return { imported: allListings.length, detailed };
}

async function upsertFromProfile(
  tenantId: string,
  listing: ZillowProfileListing,
  profileUrl: string,
  now: Date
) {
  const hubspotId = `zillow:${listing.zpid}`;
  const addr = listing.address.slice(0, 500) || `Listing ${listing.zpid}`;
  const short = shortAddr(addr);

  await prisma.cachedListing.upsert({
    where: { tenantId_hubspotId: { tenantId, hubspotId } },
    create: {
      tenantId,
      hubspotId,
      address: addr,
      shortAddress: short,
      city: listing.city,
      state: listing.state,
      zip: listing.zip || null,
      beds: listing.beds,
      baths: listing.baths,
      sqft: listing.sqft && listing.sqft > 0 ? listing.sqft : null,
      price: parsePrice(listing.price),
      priceDisplay: listing.price || "—",
      status: listing.status || "ZILLOW",
      daysOnMarket: null,
      features: null,
      notes: null,
      mlsNumber: null,
      driveFolderId: null,
      rawData: {
        source: "zillow",
        zpid: listing.zpid,
        listingUrl: listing.listingUrl,
        thumbnailUrl: listing.thumbnailUrl,
        profileUrl,
      },
      lastSyncedAt: now,
    },
    update: {
      address: addr,
      shortAddress: short,
      city: listing.city || undefined,
      state: listing.state || undefined,
      zip: listing.zip || undefined,
      beds: listing.beds,
      baths: listing.baths,
      sqft: listing.sqft && listing.sqft > 0 ? listing.sqft : undefined,
      price: parsePrice(listing.price) ?? undefined,
      priceDisplay: listing.price || undefined,
      status: listing.status || undefined,
      rawData: {
        source: "zillow",
        zpid: listing.zpid,
        listingUrl: listing.listingUrl,
        thumbnailUrl: listing.thumbnailUrl,
        profileUrl,
      },
      lastSyncedAt: now,
    },
  });
}

async function enrichWithDetail(
  tenantId: string,
  zpid: string,
  detail: ZillowListingDetail,
  now: Date
) {
  const hubspotId = `zillow:${zpid}`;

  const existing = await prisma.cachedListing.findUnique({
    where: { tenantId_hubspotId: { tenantId, hubspotId } },
  });
  if (!existing) return;

  const existingRaw = (existing.rawData ?? {}) as Record<string, unknown>;

  const features = [
    ...detail.features,
    ...detail.interiorDetails,
    ...detail.exteriorDetails,
    detail.parking ? `Parking: ${detail.parking}` : "",
    detail.heating ? `Heating: ${detail.heating}` : "",
    detail.cooling ? `Cooling: ${detail.cooling}` : "",
    detail.flooring ? `Flooring: ${detail.flooring}` : "",
    ...(detail.appliances.length ? [`Appliances: ${detail.appliances.join(", ")}`] : []),
  ]
    .filter(Boolean)
    .join(" | ");

  await prisma.cachedListing.update({
    where: { id: existing.id },
    data: {
      address: detail.address || existing.address,
      shortAddress: shortAddr(detail.address || existing.address),
      city: detail.city || existing.city,
      state: detail.state || existing.state,
      zip: detail.zip || existing.zip,
      beds: detail.beds ?? existing.beds,
      baths: detail.baths ?? existing.baths,
      sqft: detail.sqft ?? existing.sqft,
      price: parsePrice(detail.price) ?? existing.price,
      priceDisplay: detail.price || existing.priceDisplay,
      status: detail.status || existing.status,
      daysOnMarket: detail.daysOnZillow ?? existing.daysOnMarket,
      mlsNumber: detail.mlsNumber ?? existing.mlsNumber,
      features: features || existing.features,
      notes: detail.description ?? existing.notes,
      rawData: {
        ...existingRaw,
        detail: {
          description: detail.description,
          propertyType: detail.propertyType,
          yearBuilt: detail.yearBuilt,
          lotSize: detail.lotSize,
          hoaFee: detail.hoaFee,
          taxAssessedValue: detail.taxAssessedValue,
          annualTax: detail.annualTax,
          schoolDistrict: detail.schoolDistrict,
          nearbySchools: detail.nearbySchools,
          photoUrls: detail.photoUrls,
          virtualTourUrl: detail.virtualTourUrl,
          listingAgent: detail.listingAgent,
          listingBrokerage: detail.listingBrokerage,
          neighborhood: detail.neighborhood,
          walkScore: detail.walkScore,
          transitScore: detail.transitScore,
        },
      },
      lastSyncedAt: now,
    },
  });
}

async function syncViaHtmlFallback(
  sourceId: string,
  tenantId: string,
  profileUrl: string
): Promise<SyncResult> {
  const html = await fetchZillowProfileHtml(profileUrl);
  const hints = parseZillowListingHints(html);
  const now = new Date();

  for (const h of hints) {
    const hubspotId = `zillow:${h.zpid}`;
    const addr = h.addressGuess.slice(0, 500);
    const short = addr.slice(0, 120);

    await prisma.cachedListing.upsert({
      where: { tenantId_hubspotId: { tenantId, hubspotId } },
      create: {
        tenantId,
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
          profileUrl,
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
          profileUrl,
        },
        lastSyncedAt: now,
      },
    });
  }

  await prisma.zillowProfileSource.update({
    where: { id: sourceId },
    data: {
      lastSyncedAt: now,
      lastSyncError: hints.length
        ? null
        : "No listing links found. Set FIRECRAWL_API_KEY for better results.",
    },
  });

  return { imported: hints.length, detailed: 0 };
}
