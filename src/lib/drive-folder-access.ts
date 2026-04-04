import { isFolderUnderRoot } from "@/lib/drive";
import { prisma } from "@/lib/prisma";

type AllowOpts = {
  /** When set, any folder under the tenant Drive root may list photos (Drive-only listings). */
  accessToken?: string;
};

/**
 * Tenant may list photos for the configured root, any folder under that root (listing subfolders),
 * or a folder linked on a cached HubSpot listing.
 */
export async function isFolderAllowedForTenant(
  tenantId: string,
  folderId: string,
  opts?: AllowOpts
): Promise<boolean> {
  const cfg = await prisma.driveConfig.findUnique({
    where: { tenantId },
    select: { rootFolderId: true },
  });
  if (!cfg) return false;
  if (cfg.rootFolderId === folderId) return true;

  const listing = await prisma.cachedListing.findFirst({
    where: { tenantId, driveFolderId: folderId },
    select: { id: true },
  });
  if (listing) return true;

  if (opts?.accessToken) {
    return isFolderUnderRoot(opts.accessToken, cfg.rootFolderId, folderId);
  }

  return false;
}
