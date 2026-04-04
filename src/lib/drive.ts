import { google } from "googleapis";

export function getDriveClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

const driveListOpts = {
  supportsAllDrives: true,
  includeItemsFromAllDrives: true,
} as const;

export async function listPhotosInFolder(accessToken: string, folderId: string) {
  const drive = getDriveClient(accessToken);
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: "files(id, name, mimeType, size, thumbnailLink, webContentLink)",
    pageSize: 50,
    ...driveListOpts,
  });
  return res.data.files ?? [];
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
      listPhotosInFolder(accessToken, folder.id),
      listSubfolders(accessToken, folder.id),
    ]);

    if (photos.length > 0) {
      result.push(folder);
    } else if (sub.length > 0) {
      for (const s of sub.slice(0, MAX_SUBFOLDERS)) {
        const parentName = folder.name?.trim() ?? "";
        const childName = s.name?.trim() ?? "";
        const combined =
          parentName && childName ? `${parentName} / ${childName}` : parentName || childName || s.id;
        result.push({ id: s.id, name: combined });
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
