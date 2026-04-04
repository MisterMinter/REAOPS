import { prisma } from "@/lib/prisma";

/**
 * Tenant may only list Drive folders that are the configured root or a cached listing folder.
 */
export async function isFolderAllowedForTenant(tenantId: string, folderId: string): Promise<boolean> {
  const cfg = await prisma.driveConfig.findUnique({
    where: { tenantId },
    select: { rootFolderId: true },
  });
  if (cfg?.rootFolderId === folderId) return true;

  const listing = await prisma.cachedListing.findFirst({
    where: { tenantId, driveFolderId: folderId },
    select: { id: true },
  });
  return Boolean(listing);
}
