import { google, type drive_v3 } from "googleapis";

export function getDriveClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

const driveListOpts = {
  supportsAllDrives: true,
  includeItemsFromAllDrives: true,
} as const;

/** List images that are direct children of a folder (no recursion). */
export async function listDirectPhotos(accessToken: string, folderId: string) {
  const drive = getDriveClient(accessToken);
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: "files(id, name, mimeType, size, thumbnailLink, webContentLink)",
    pageSize: 50,
    ...driveListOpts,
  });
  return res.data.files ?? [];
}

/**
 * List photos in a folder. If no direct image children exist, recurse up to
 * MAX_PHOTO_DEPTH levels into subfolders (handles MARKETING/PICTURES layouts).
 * Prioritizes folders named for web/MLS photos over print/floorplan folders.
 */
const MAX_PHOTO_DEPTH = 3;

/** Folders likely to contain listing photos, checked first (case-insensitive). */
const PREFERRED_FOLDER_NAMES = ["for web/mls", "for web", "web", "pictures", "images", "photos", "mls"];
const DEPRIORITIZED_FOLDER_NAMES = ["floorplan", "floorplans", "floor plan", "floor plans", "for print", "print", "video", "videos"];

function folderPriority(name: string | null | undefined): number {
  const lower = (name ?? "").toLowerCase().trim();
  if (PREFERRED_FOLDER_NAMES.includes(lower)) return 0;
  if (DEPRIORITIZED_FOLDER_NAMES.includes(lower)) return 2;
  return 1;
}

export async function listPhotosInFolder(accessToken: string, folderId: string, depth = 0): Promise<drive_v3.Schema$File[]> {
  const photos = await listDirectPhotos(accessToken, folderId);
  if (photos.length > 0 || depth >= MAX_PHOTO_DEPTH) return photos;

  const subs = await listSubfolders(accessToken, folderId);
  const sorted = [...subs].sort((a, b) => folderPriority(a.name) - folderPriority(b.name));
  for (const sub of sorted.slice(0, 10)) {
    const nested = await listPhotosInFolder(accessToken, sub.id, depth + 1);
    if (nested.length > 0) return nested;
  }
  return [];
}

export type DriveFolderRef = { id: string; name: string | null | undefined };

export async function listSubfolders(accessToken: string, parentFolderId: string): Promise<DriveFolderRef[]> {
  const drive = getDriveClient(accessToken);
  const res = await drive.files.list({
    q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 100,
    ...driveListOpts,
  });
  const files = res.data.files ?? [];
  return files.filter((f): f is DriveFolderRef => typeof f.id === "string");
}

const MAX_LEVEL1_FOLDERS = 40;
const MAX_SUBFOLDERS = 60;

/**
 * Listing folders: direct children of root that contain photos, OR (if a child has no photos but has
 * subfolders) those grandchildren — handles `Root / Region / 123 Main St` style layouts.
 */
export async function listDriveListingFolders(
  accessToken: string,
  rootFolderId: string
): Promise<DriveFolderRef[]> {
  const level1 = (await listSubfolders(accessToken, rootFolderId)).slice(0, MAX_LEVEL1_FOLDERS);
  const result: DriveFolderRef[] = [];

  for (const folder of level1) {
    const [photos, sub] = await Promise.all([
      listDirectPhotos(accessToken, folder.id),
      listSubfolders(accessToken, folder.id),
    ]);

    if (photos.length > 0) {
      result.push(folder);
    } else if (sub.length > 0) {
      for (const s of sub.slice(0, MAX_SUBFOLDERS)) {
        const childName = s.name?.trim() ?? "";
        // Use child name alone — parent is just a category (e.g. COMMERCIAL, RESIDENTIAL)
        result.push({ id: s.id, name: childName || s.id });
      }
    } else {
      result.push(folder);
    }
  }

  return result;
}

async function getFolderParents(accessToken: string, fileId: string): Promise<string[]> {
  const drive = getDriveClient(accessToken);
  const meta = await drive.files.get({
    fileId,
    fields: "parents",
    supportsAllDrives: true,
  });
  return meta.data.parents ?? [];
}

/** True if `folderId` is the root or any descendant folder under `rootFolderId`. */
export async function isFolderUnderRoot(
  accessToken: string,
  rootFolderId: string,
  folderId: string
): Promise<boolean> {
  if (folderId === rootFolderId) return true;
  let current: string | undefined = folderId;
  for (let depth = 0; depth < 64 && current; depth++) {
    const parents = await getFolderParents(accessToken, current);
    if (parents.length === 0) return false;
    if (parents.includes(rootFolderId)) return true;
    current = parents[0];
  }
  return false;
}
