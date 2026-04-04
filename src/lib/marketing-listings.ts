/**
 * Marketing pack can combine HubSpot-synced rows (CachedListing) with Drive-only
 * property folders (subfolders of the tenant root, named by address).
 */

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
