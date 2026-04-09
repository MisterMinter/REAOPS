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
 *
 * Handles multi-address folder names like "1321 Holden/1729 Verdery" by
 * splitting on "/" and matching each sub-address independently. Multiple
 * listings can share one Drive folder (the folder represents a combined
 * property package).
 */
export async function autoLinkDriveFolders(
  cached: CachedListingSlice[],
  driveFolders: DriveFolderSlice[]
): Promise<CachedListingSlice[]> {
  if (!driveFolders.length) return cached;

  const unlinkedCached = cached.filter((c) => !c.driveFolderId);
  const availableFolders = driveFolders.filter((f) => f.name);

  if (!unlinkedCached.length || !availableFolders.length) return cached;

  const folderSubAddresses = new Map<string, { folder: DriveFolderSlice; parts: string[] }>();
  for (const folder of availableFolders) {
    const raw = folder.name ?? "";
    const parts = splitFolderName(raw)
      .map(normalizeAddress)
      .filter(Boolean);
    if (parts.length > 0) {
      folderSubAddresses.set(folder.id, { folder, parts });
    }
  }

  const updates: { listingId: string; folderId: string }[] = [];

  for (const listing of unlinkedCached) {
    const listingNorm = normalizeAddress(listing.address);
    const shortNorm = normalizeAddress(listing.shortAddress);
    if (!listingNorm && !shortNorm) continue;

    let bestFolderId: string | null = null;
    let bestScore = 0;

    for (const [folderId, { parts }] of folderSubAddresses) {
      for (const part of parts) {
        const score = Math.max(
          addressSimilarity(listingNorm, part),
          addressSimilarity(shortNorm, part)
        );
        if (score > bestScore) {
          bestScore = score;
          bestFolderId = folderId;
        }
      }
    }

    if (bestFolderId && bestScore >= 0.7) {
      updates.push({ listingId: listing.id, folderId: bestFolderId });
    }
  }

  if (updates.length > 0) {
    console.log(`[marketing-listings] Auto-linking ${updates.length} Drive folder(s) to listings`);
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

/**
 * Split a Drive folder name that may contain multiple addresses separated
 * by "/" or "&" or "and". e.g. "1321 Holden/1729 Verdery" → ["1321 Holden", "1729 Verdery"]
 * Returns at least one part (the full string) if no separators are found.
 */
function splitFolderName(name: string): string[] {
  const parts = name
    .split(/[/&]|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [name];
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
 * expand/collapse street suffix abbreviations, remove unit/apt qualifiers
 * and bare unit designators like #A, #B, #201.
 */
function normalizeAddress(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/#\s*\w+/g, " ")
    .replace(/[.,\-_/\\()]/g, " ")
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
