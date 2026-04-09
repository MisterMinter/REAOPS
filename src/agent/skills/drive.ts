import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./types";
import {
  getDriveClient,
  listSubfolders,
  listPhotosInFolder,
} from "@/lib/drive";

export function driveTools(ctx: ToolContext) {
  function requireToken() {
    if (!ctx.accessToken) throw new Error("No Google Drive token. User needs to sign in with Google.");
    return ctx.accessToken;
  }

  return {
    drive_list_folders: tool({
      description: "List subfolders in a Google Drive folder. Use the tenant root folder ID if no parentId given.",
      parameters: z.object({
        parentId: z.string().optional().describe("Folder ID. Defaults to tenant Drive root."),
      }),
      execute: async ({ parentId }) => {
        const token = requireToken();
        const fid = parentId ?? ctx.driveRootFolderId;
        if (!fid) return { error: "No Drive root folder configured." };
        const folders = await listSubfolders(token, fid);
        return { folders: folders.map((f) => ({ id: f.id, name: f.name })) };
      },
    }),

    drive_list_files: tool({
      description: "List files (photos, docs, etc.) inside a Google Drive folder.",
      parameters: z.object({
        folderId: z.string().describe("The folder ID to list files from."),
      }),
      execute: async ({ folderId }) => {
        const token = requireToken();
        const drive = getDriveClient(token);
        const res = await drive.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          fields: "files(id, name, mimeType, size, thumbnailLink, webViewLink)",
          pageSize: 50,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        return { files: res.data.files ?? [] };
      },
    }),

    drive_get_file_info: tool({
      description: "Get metadata for a specific Google Drive file.",
      parameters: z.object({
        fileId: z.string().describe("The file ID."),
      }),
      execute: async ({ fileId }) => {
        const token = requireToken();
        const drive = getDriveClient(token);
        const res = await drive.files.get({
          fileId,
          fields: "id, name, mimeType, size, parents, webViewLink, thumbnailLink, createdTime, modifiedTime",
          supportsAllDrives: true,
        });
        return res.data;
      },
    }),

    drive_move_file: tool({
      description: "Move a file from one Drive folder to another.",
      parameters: z.object({
        fileId: z.string().describe("The file to move."),
        newParentId: z.string().describe("Destination folder ID."),
      }),
      execute: async ({ fileId, newParentId }) => {
        const token = requireToken();
        const drive = getDriveClient(token);
        const file = await drive.files.get({ fileId, fields: "parents", supportsAllDrives: true });
        const prev = file.data.parents?.join(",") ?? "";
        await drive.files.update({
          fileId,
          addParents: newParentId,
          removeParents: prev,
          supportsAllDrives: true,
        });
        return { moved: true, fileId, newParentId };
      },
    }),

    drive_create_doc: tool({
      description: "Create a Google Doc in a Drive folder with the given title and body text.",
      parameters: z.object({
        folderId: z.string().describe("Folder ID to create the doc in."),
        title: z.string().describe("Document title."),
        content: z.string().describe("Plain-text body to write into the doc."),
      }),
      execute: async ({ folderId, title, content }) => {
        const token = requireToken();
        const drive = getDriveClient(token);
        const res = await drive.files.create({
          requestBody: {
            name: title,
            mimeType: "application/vnd.google-apps.document",
            parents: [folderId],
          },
          supportsAllDrives: true,
        });
        const docId = res.data.id;
        if (docId && content) {
          const auth = new (await import("googleapis")).google.auth.OAuth2();
          auth.setCredentials({ access_token: token });
          const docs = (await import("googleapis")).google.docs({ version: "v1", auth });
          await docs.documents.batchUpdate({
            documentId: docId,
            requestBody: {
              requests: [{ insertText: { location: { index: 1 }, text: content } }],
            },
          });
        }
        return { created: true, docId, title, folderId };
      },
    }),

    drive_search: tool({
      description: "Search Google Drive files by name within the tenant's folder tree.",
      parameters: z.object({
        query: z.string().describe("Search query (file name substring)."),
      }),
      execute: async ({ query }) => {
        const token = requireToken();
        const drive = getDriveClient(token);
        const q = ctx.driveRootFolderId
          ? `name contains '${query.replace(/'/g, "\\'")}' and '${ctx.driveRootFolderId}' in parents and trashed = false`
          : `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`;
        const res = await drive.files.list({
          q,
          fields: "files(id, name, mimeType, parents, webViewLink)",
          pageSize: 20,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        return { results: res.data.files ?? [] };
      },
    }),

    drive_get_photos: tool({
      description: "List photo/image files in a Drive folder (convenience for listing marketing).",
      parameters: z.object({
        folderId: z.string().describe("Folder ID containing photos."),
      }),
      execute: async ({ folderId }) => {
        const token = requireToken();
        const photos = await listPhotosInFolder(token, folderId);
        return { photos };
      },
    }),
  };
}
