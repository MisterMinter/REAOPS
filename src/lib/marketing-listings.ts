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

const STREET_SUFFIXES: Record<string, string> = {
  street: "st", st: "st",
  avenue: "ave", ave: "ave", av: "ave",
  drive: "dr", dr: "dr",
  lane: "ln", ln: "ln",
  court: "ct", ct: "ct",
  place: "pl", pl: "pl",
  circle: "cir", cir: "cir",
  boulevard: "blvd", blvd: "blvd",
  road: "rd", rd: "rd",
  way: "way",
  trail: "trl", trl: "trl",
  terrace: "ter", ter: "ter",
  parkway: "pkwy", pkwy: "pkwy",
  highway: "hwy", hwy: "hwy",
  crossing: "xing", xing: "xing",
  point: "pt", pt: "pt",
  pass: "pass",
  run: "run",
  walk: "walk",
  hollow: "holw", holw: "holw",

  north: "n", n: "n",
  south: "s", s: "s",
  east: "e", e: "e",
  west: "w", w: "w",
  northeast: "ne", ne: "ne",
  northwest: "nw", nw: "nw",
  southeast: "se", se: "se",
  southwest: "sw", sw: "sw",
};

/**
 * Normalize an address string for comparison: lowercase, strip punctuation,
 * expand/collapse street suffix abbreviations, remove unit/apt qualifiers.
 */
function normalizeAddress(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,#\-_/\\()]/g, " ")
    .replace(/\b(apt|unit|suite|ste|bldg|building|floor|fl)\b\s*\S*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .map((tok) => STREET_SUFFIXES[tok] ?? tok)
    .join(" ");
}

/**
 * Compute similarity between two normalized address strings.
 * Uses token overlap (Jaccard-like) + containment checks.
 */
function addressSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  if (a === b) return 1;

  if (a.includes(b) || b.includes(a)) return 0.95;

  const tokensA = new Set(a.split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.split(/\s+/).filter(Boolean));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }

  const union = tokensA.size + tokensB.size - overlap;
  const jaccard = overlap / union;
  const recall = overlap / Math.min(tokensA.size, tokensB.size);

  return recall * 0.7 + jaccard * 0.3;
}
