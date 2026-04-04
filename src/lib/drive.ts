import { google } from "googleapis";

export function getDriveClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

export async function listPhotosInFolder(accessToken: string, folderId: string) {
  const drive = getDriveClient(accessToken);
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: "files(id, name, mimeType, size, thumbnailLink, webContentLink)",
    pageSize: 50,
  });
  return res.data.files ?? [];
}

export async function listSubfolders(accessToken: string, parentFolderId: string) {
  const drive = getDriveClient(accessToken);
  const res = await drive.files.list({
    q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 100,
  });
  return res.data.files ?? [];
}
