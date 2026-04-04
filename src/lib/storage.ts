import { encodeLogoDataUrl } from "@/lib/tenant-logo";

const ALLOWED_MIME = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

/**
 * Store tenant logo in the database as a data URL (works on Railway without disk or GCS).
 */
export async function uploadTenantLogo(
  _tenantId: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const ext = ALLOWED_MIME.get(mimeType);
  if (!ext) throw new Error("Unsupported image type");
  return encodeLogoDataUrl(mimeType, buffer);
}
