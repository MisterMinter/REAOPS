import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listPhotosInFolder } from "@/lib/drive";
import { isFolderAllowedForTenant } from "@/lib/drive-folder-access";
import { getGoogleAccessTokenForUser } from "@/lib/google-account-token";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.tenantId || !session.user.id) {
    return NextResponse.json({ error: "Tenant required" }, { status: 403 });
  }

  const accessToken = await getGoogleAccessTokenForUser(session.user.id);
  if (!accessToken) {
    return NextResponse.json(
      {
        error: "No Google Drive access",
        hint:
          "Sign out, sign in again with Google (same account that can open the folder). If this persists, remove the app under Google Account → Security → third-party access, then sign in once more so a refresh token is stored.",
        code: session.error ?? "NO_ACCESS_TOKEN",
      },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const folderId = searchParams.get("folderId")?.trim();
  if (!folderId) {
    return NextResponse.json({ error: "folderId query parameter is required" }, { status: 400 });
  }

  const allowed = await isFolderAllowedForTenant(session.user.tenantId, folderId, {
    accessToken,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "Folder is not configured for this brokerage" },
      { status: 403 }
    );
  }

  try {
    const files = await listPhotosInFolder(accessToken, folderId);
    return NextResponse.json({ files });
  } catch (e) {
    console.error("Drive listPhotosInFolder", e);
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("401") || msg.includes("invalid authentication")) {
      return NextResponse.json(
        {
          error: "Google rejected the access token",
          hint: "Sign out and sign in again; enable Google Drive API on your OAuth GCP project.",
        },
        { status: 401 }
      );
    }
    return NextResponse.json({ error: "Drive API request failed" }, { status: 502 });
  }
}
