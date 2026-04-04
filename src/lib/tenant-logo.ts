/** Logos are stored in the DB as data URLs; keep uploads small for Postgres and HTML responses. */
export const MAX_LOGO_BYTES = 400_000;

/**
 * Encode a logo for `Tenant.logoUrl`. Survives serverless/PaaS where disk is ephemeral.
 */
export function encodeLogoDataUrl(mimeType: string, buffer: Buffer): string {
  if (buffer.length > MAX_LOGO_BYTES) {
    throw new Error(`Logo must be under ${Math.round(MAX_LOGO_BYTES / 1024)}KB`);
  }
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

/**
 * Value safe to pass to <img src>. Legacy `/uploads/...` paths are dropped (files don't survive
 * Railway redeploys) so we show the fallback mark instead of a broken image.
 */
export function resolveTenantLogoForDisplay(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null;
  const u = logoUrl.trim();
  if (u.startsWith("data:image/")) return u;
  if (u.startsWith("https://") || u.startsWith("http://")) return u;
  if (u.startsWith("/")) return null;
  return u;
}

export function hasLegacyRelativeLogoPath(logoUrl: string | null | undefined): boolean {
  return Boolean(logoUrl?.trim().startsWith("/"));
}
