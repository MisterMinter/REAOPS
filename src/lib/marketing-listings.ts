/**
 * Marketing pack can combine HubSpot/Zillow-synced rows (CachedListing) with
 * Drive-only property folders (subfolders of the tenant root, named by address).
 *
 * Dedup strategy: fuzzy-match Drive folder names against CachedListing addresses
 * to auto-link them. Zillow data is treated as primary (richer info), and the
 * Drive folder is attached for photos/documents.
 */

import { prisma } from "@/lib/prisma";

export type MarketingListingSource =
  | "hubspot"
  | "drive"
  | "both"
  | "zillow"
  | "zillow_drive";

export type MarketingListingRow = {
  key: string;
  title: string;
  source: MarketingListingSource;
  driveFolderId: string | null;
  hubspotId: string | null;
  cachedListingId: string | null;
};

type CachedListingSlice = {
  id: string;
  hubspotId: string;
  address: string;
  shortAddress: string;
  driveFolderId: string | null;
};

type DriveFolderSlice = { id: string; name: string | null | undefined };

function rowSourceFromCached(c: CachedListingSlice): MarketingListingSource {
  const fromZillow = c.hubspotId.startsWith("zillow:");
  if (fromZillow && c.driveFolderId) return "zillow_drive";
  if (fromZillow) return "zillow";
  if (c.driveFolderId) return "both";
  return "hubspot";
}

export function mergedListingCount(
  cached: { driveFolderId: string | null }[],
  driveFolders: { id: string }[] | null
): number {
  if (!driveFolders?.length) return cached.length;
  const linked = new Set(
    cached.map((c) => c.driveFolderId).filter((id): id is string => Boolean(id))
  );
  const driveOnly = driveFolders.filter((f) => !linked.has(f.id)).length;
  return cached.length + driveOnly;
}

/**
 * Auto-link Drive folders to CachedListings by fuzzy address match.
 * Persists the link (sets driveFolderId) so future calls skip them.
 */
export async function autoLinkDriveFolders(
  cached: CachedListingSlice[],
  driveFolders: DriveFolderSlice[]
): Promise<CachedListingSlice[]> {
  if (!driveFolders.length) return cached;

  const linkedIds = new Set(
    cached.map((c) => c.driveFolderId).filter((id): id is string => Boolean(id))
  );

  const unlinkedCached = cached.filter((c) => !c.driveFolderId);
  const unlinkedFolders = driveFolders.filter((f) => !linkedIds.has(f.id) && f.name);

  if (!unlinkedCached.length || !unlinkedFolders.length) return cached;

  const updates: { listingId: string; folderId: string }[] = [];
  const usedFolderIds = new Set<string>();

  for (const listing of unlinkedCached) {
    const listingNorm = normalizeAddress(listing.address);
    const shortNorm = normalizeAddress(listing.shortAddress);
    if (!listingNorm && !shortNorm) continue;

    let bestMatch: DriveFolderSlice | null = null;
    let bestScore = 0;

    for (const folder of unlinkedFolders) {
      if (usedFolderIds.has(folder.id)) continue;
      const folderNorm = normalizeAddress(folder.name ?? "");
      if (!folderNorm) continue;

      const score = Math.max(
        addressSimilarity(listingNorm, folderNorm),
        addressSimilarity(shortNorm, folderNorm)
      );

      if (score > bestScore) {
        bestScore = score;
        bestMatch = folder;
      }
    }

    if (bestMatch && bestScore >= 0.7) {
      updates.push({ listingId: listing.id, folderId: bestMatch.id });
      usedFolderIds.add(bestMatch.id);
    }
  }

  if (updates.length > 0) {
    console.log(`[marketing-listings] Auto-linking ${updates.length} Drive folder(s) to Zillow listings`);
    for (const { listingId, folderId } of updates) {
      try {
        await prisma.cachedListing.update({
          where: { id: listingId },
          data: { driveFolderId: folderId },
        });
        const listing = cached.find((c) => c.id === listingId);
        if (listing) listing.driveFolderId = folderId;
      } catch (e) {
        console.warn(`[marketing-listings] Failed to link listing ${listingId}:`, e);
      }
    }
  }

  return cached;
}

export function buildMarketingListingRows(
  cached: CachedListingSlice[],
  driveFolders: DriveFolderSlice[]
): MarketingListingRow[] {
  const rows: MarketingListingRow[] = [];
  const linkedDriveIds = new Set<string>();

  for (const c of cached) {
    if (c.driveFolderId) linkedDriveIds.add(c.driveFolderId);
    rows.push({
      key: `hs:${c.id}`,
      title: (c.shortAddress || c.address).trim() || "Listing",
      source: rowSourceFromCached(c),
      driveFolderId: c.driveFolderId,
      hubspotId: c.hubspotId,
      cachedListingId: c.id,
    });
  }

  for (const f of driveFolders) {
    if (linkedDriveIds.has(f.id)) continue;
    rows.push({
      key: `drive:${f.id}`,
      title: (f.name ?? "").trim() || "Untitled folder",
      source: "drive",
      driveFolderId: f.id,
      hubspotId: null,
      cachedListingId: null,
    });
  }

  rows.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  return rows;
}

// ---------------------------------------------------------------------------
// Address normalization + fuzzy matching
// ---------------------------------------------------------------------------

/**
 * Normalize an address string for comparison: lowercase, strip punctuation,
 * collapse whitespace, remove common suffixes like "st", "ave", "dr", etc.
 */
function normalizeAddress(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,#\-_/\\()]/g, " ")
    .replace(/\b(apt|unit|suite|ste|bldg|building|floor|fl)\b\s*\S*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compute similarity between two normalized address strings.
 * Uses token overlap (Jaccard-like) — works well for addresses where
 * word order may differ or partial info is present (e.g. "123 Main" vs "123 Main St, Springfield").
 */
function addressSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  // Exact match
  if (a === b) return 1;

  // One fully contains the other
  if (a.includes(b) || b.includes(a)) return 0.95;

  const tokensA = new Set(a.split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.split(/\s+/).filter(Boolean));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }

  // Jaccard: overlap / union
  const union = tokensA.size + tokensB.size - overlap;
  const jaccard = overlap / union;

  // Also weight by how much of the smaller set is covered (recall)
  const recall = overlap / Math.min(tokensA.size, tokensB.size);

  // Blend: primarily recall (street number + name match is key), with Jaccard as tiebreaker
  return recall * 0.7 + jaccard * 0.3;
}
