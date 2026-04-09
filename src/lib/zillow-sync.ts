import { prisma } from "@/lib/prisma";
import {
  scrapeZillowProfile,
  batchScrapeListingDetails,
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
  errors: string[];
  durationMs: number;
};

const activeSyncs = new Set<string>();

/**
 * Sync a Zillow profile source using Firecrawl structured extract.
 * Prevents concurrent syncs of the same source.
 */
export async function syncZillowProfileSource(sourceId: string): Promise<SyncResult> {
  if (activeSyncs.has(sourceId)) {
    log("Sync already in progress, skipping duplicate", { sourceId });
    return { imported: 0, detailed: 0, errors: ["Sync already in progress"], durationMs: 0 };
  }

  activeSyncs.add(sourceId);
  try {
    return await doSync(sourceId);
  } finally {
    activeSyncs.delete(sourceId);
  }
}

async function doSync(sourceId: string): Promise<SyncResult> {
  const t0 = Date.now();
  const src = await prisma.zillowProfileSource.findUnique({ where: { id: sourceId } });
  if (!src) return { imported: 0, detailed: 0, errors: ["Source not found"], durationMs: 0 };

  log("=== SYNC START ===", { sourceId, url: src.profileUrl });

  const useFirecrawl = Boolean(process.env.FIRECRAWL_API_KEY?.trim());

  try {
    const result = useFirecrawl
      ? await syncViaFirecrawl(src.id, src.tenantId, src.profileUrl)
      : await syncViaHtmlFallback(src.id, src.tenantId, src.profileUrl);

    result.durationMs = Date.now() - t0;
    log("=== SYNC COMPLETE ===", {
      sourceId,
      imported: result.imported,
      detailed: result.detailed,
      errors: result.errors.length,
      durationMs: result.durationMs,
    });
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sync failed";
    log("=== SYNC FAILED ===", { sourceId, error: msg });
    await prisma.zillowProfileSource.update({
      where: { id: sourceId },
      data: { lastSyncError: msg },
    });
    return { imported: 0, detailed: 0, errors: [msg], durationMs: Date.now() - t0 };
  }
}

async function syncViaFirecrawl(
  sourceId: string,
  tenantId: string,
  profileUrl: string
): Promise<SyncResult> {
  const errors: string[] = [];

  // Step 1: Scrape profile page
  log("Step 1: Scraping profile page");
  const profile = await scrapeZillowProfile(profileUrl);
  const now = new Date();

  const allListings = [
    ...profile.activeListings,
    ...profile.soldListings,
    ...profile.rentals,
  ];

  log("Profile scraped", {
    agent: profile.agentName,
    active: profile.activeListings.length,
    sold: profile.soldListings.length,
    rentals: profile.rentals.length,
  });

  // Step 2: Upsert all listings from profile
  log("Step 2: Upserting listings from profile", { count: allListings.length });
  for (const listing of allListings) {
    try {
      await upsertFromProfile(tenantId, listing, profileUrl, now);
    } catch (e) {
      const msg = `Upsert failed for ${listing.address}: ${e instanceof Error ? e.message : e}`;
      log("Upsert error", msg);
      errors.push(msg);
    }
  }

  // Step 3: Batch-scrape active listing details
  const activeUrls = profile.activeListings
    .map((l) => l.listingUrl)
    .filter(Boolean);

  let detailed = 0;
  if (activeUrls.length > 0) {
    log("Step 3: Batch-scraping listing details", { count: activeUrls.length });
    try {
      const detailMap = await batchScrapeListingDetails(activeUrls);

      for (const listing of profile.activeListings) {
        if (!listing.listingUrl) continue;
        const detail = detailMap.get(listing.listingUrl);
        if (!detail) {
          errors.push(`No detail data for ${listing.address}`);
          continue;
        }
        try {
          await enrichWithDetail(tenantId, listing.zpid, detail, now);
          detailed++;
          log("Enriched listing", { address: detail.address || listing.address, zpid: listing.zpid });
        } catch (e) {
          const msg = `Enrich failed for ${listing.address}: ${e instanceof Error ? e.message : e}`;
          log("Enrich error", msg);
          errors.push(msg);
        }
      }
    } catch (e) {
      const msg = `Batch detail scrape failed: ${e instanceof Error ? e.message : e}`;
      log("Batch error", msg);
      errors.push(msg);
    }
  } else {
    log("Step 3: Skipped (no active listing URLs)");
  }

  await prisma.zillowProfileSource.update({
    where: { id: sourceId },
    data: {
      lastSyncedAt: now,
      lastSyncError: allListings.length
        ? (errors.length ? errors.slice(0, 3).join("; ") : null)
        : "No listings found on profile page.",
    },
  });

  return { imported: allListings.length, detailed, errors, durationMs: 0 };
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
  log("Using HTML fallback (no FIRECRAWL_API_KEY)");
  const html = await fetchZillowProfileHtml(profileUrl);
  const hints = parseZillowListingHints(html);
  const now = new Date();
  const errors: string[] = [];

  for (const h of hints) {
    const hubspotId = `zillow:${h.zpid}`;
    const addr = h.addressGuess.slice(0, 500);
    const short = addr.slice(0, 120);

    try {
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
    } catch (e) {
      errors.push(`Upsert ${h.zpid}: ${e instanceof Error ? e.message : e}`);
    }
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

  return { imported: hints.length, detailed: 0, errors, durationMs: 0 };
}

function log(label: string, data?: unknown) {
  const ts = new Date().toISOString();
  if (data !== undefined) {
    console.log(`[zillow-sync ${ts}] ${label}`, typeof data === "string" ? data : JSON.stringify(data));
  } else {
    console.log(`[zillow-sync ${ts}] ${label}`);
  }
}
