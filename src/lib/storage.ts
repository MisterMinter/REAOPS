import { mkdir, writeFile } from "fs/promises";
import path from "path";

const ALLOWED_MIME = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

/**
 * Upload tenant logo. Uses GCS when GCS_BUCKET_LOGOS + service account env are set;
 * otherwise writes under /public/uploads (dev only — document in README).
 */
export async function uploadTenantLogo(
  tenantId: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const ext = ALLOWED_MIME.get(mimeType);
  if (!ext) throw new Error("Unsupported image type");

  const bucket = process.env.GCS_BUCKET_LOGOS;
  if (bucket && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    const { Storage } = await import("@google-cloud/storage");
    const storage = new Storage({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n"),
      },
    });
    const objectPath = `tenants/${tenantId}/logo.${ext}`;
    const file = storage.bucket(bucket).file(objectPath);
    await file.save(buffer, {
      contentType: mimeType,
      metadata: { cacheControl: "public, max-age=31536000" },
    });
    const base = process.env.GCS_PUBLIC_BASE_URL?.replace(/\/$/, "");
    if (base) return `${base}/${objectPath}`;
    await file.makePublic();
    return `https://storage.googleapis.com/${bucket}/${objectPath}`;
  }

  const dir = path.join(process.cwd(), "public", "uploads", "tenants", tenantId);
  await mkdir(dir, { recursive: true });
  const filename = `logo.${ext}`;
  const fsPath = path.join(dir, filename);
  await writeFile(fsPath, buffer);
  return `/uploads/tenants/${tenantId}/${filename}`;
}
