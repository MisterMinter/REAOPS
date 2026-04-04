import Link from "next/link";
import { auth } from "@/auth";
import { type DriveFolderRef, listDriveListingFolders } from "@/lib/drive";
import { getGoogleAccessTokenForUser } from "@/lib/google-account-token";
import { getOnboardingSnapshot } from "@/lib/onboarding";
import { type MarketingListingSource, buildMarketingListingRows } from "@/lib/marketing-listings";
import { prisma } from "@/lib/prisma";

function sourceLabel(source: MarketingListingSource) {
  const labels: Record<MarketingListingSource, string> = {
    hubspot: "HubSpot",
    drive: "Drive",
    both: "HubSpot + Drive",
    zillow: "Zillow",
    zillow_drive: "Zillow + Drive",
  };
  return labels[source];
}

export default async function MarketingPage() {
  const session = await auth();
  const user = session?.user;
  const snap = user?.id
    ? await getOnboardingSnapshot(
        prisma,
        {
          id: user.id,
          role: user.role,
          tenantId: user.tenantId,
        },
        { googleTokenUserId: user.id }
      )
    : null;

  if (!user?.tenantId) {
    return (
      <div>
        <h1 className="font-display text-3xl text-[var(--txt)]">Listing Marketing Pack</h1>
        <p className="mt-2 max-w-2xl text-[var(--txt2)]">
          Select listings, photos, and generate MLS descriptions, captions, and email lines. Connect Google Drive for
          photo folders; HubSpot is optional when you want CRM-backed fields.
        </p>
        <div className="mt-8 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/5 p-6">
          <p className="text-sm text-[var(--txt2)]">
            You are not assigned to a brokerage yet. Open{" "}
            <Link href="/start" className="text-[var(--teal)] hover:underline">
              Start
            </Link>{" "}
            for setup steps, or ask a platform admin to link your account to a tenant.
          </p>
          {user?.role === "ADMIN" && (
            <Link
              href="/admin/users"
              className="mt-4 inline-block text-sm font-medium text-[var(--gold)] hover:underline"
            >
              Admin → Users
            </Link>
          )}
        </div>
      </div>
    );
  }

  const tenantId = user.tenantId;
  const driveCfg = await prisma.driveConfig.findUnique({
    where: { tenantId },
    select: { rootFolderId: true },
  });

  const cached = await prisma.cachedListing.findMany({
    where: { tenantId },
    select: {
      id: true,
      hubspotId: true,
      address: true,
      shortAddress: true,
      driveFolderId: true,
    },
  });

  let driveFolders: DriveFolderRef[] = [];
  let driveListError: string | null = null;
  const driveToken =
    (await getGoogleAccessTokenForUser(user.id)) ?? session?.accessToken ?? null;
  if (driveCfg && driveToken) {
    try {
      driveFolders = await listDriveListingFolders(driveToken, driveCfg.rootFolderId);
    } catch (e) {
      console.error("Drive listDriveListingFolders", e);
      const msg = e instanceof Error ? e.message : "";
      const authRejected =
        msg.includes("401") ||
        msg.includes("invalid authentication") ||
        msg.includes("Invalid Credentials");
      driveListError = authRejected
        ? "Google rejected the Drive credentials (expired or revoked). Sign out of the app, sign in again with Google. If it keeps happening: Google Account → Security → Third-party access → remove this app → sign in once more (to capture a fresh refresh token), and confirm the Google Cloud project has the Drive API enabled."
        : "Could not load Drive folders. Try signing out and back in with Google.";
    }
  } else if (driveCfg && !driveToken) {
    driveListError =
      "No usable Google token for Drive (missing refresh token or refresh failed). Sign out, sign in again with the same Google account. First-time consent must include offline access so a refresh token is stored.";
  }

  const rows = buildMarketingListingRows(cached, driveFolders);

  return (
    <div>
      <h1 className="font-display text-3xl text-[var(--txt)]">Listing Marketing Pack</h1>
      <p className="mt-2 max-w-2xl text-[var(--txt2)]">
        Properties appear from <strong className="text-[var(--txt)]">subfolders</strong> under your Drive root (folder
        name = street address; photos inside), and from <strong className="text-[var(--txt)]">HubSpot</strong> when
        listings are synced. Same page for both — Drive supplies photos either way.
      </p>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Properties</div>
          <div className="mt-2 font-display text-3xl text-[var(--gold)]">{snap?.listingCount ?? rows.length}</div>
          <p className="mt-2 text-xs text-[var(--txt3)]">
            Drive subfolders + HubSpot rows (duplicates merged when a listing is linked to a folder)
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">HubSpot</div>
          <div className="mt-2 text-sm font-medium text-[var(--txt)]">
            {snap?.hubspotConnected ? (
              <span className="text-[var(--green)]">Connected</span>
            ) : (
              <span className="text-[var(--txt3)]">Not connected (optional)</span>
            )}
          </div>
          <Link href="/settings" className="mt-2 inline-block text-xs text-[var(--teal)] hover:underline">
            Status in Settings →
          </Link>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Drive</div>
          <div className="mt-2 text-sm font-medium text-[var(--txt)]">
            {snap?.hasDriveFolder ? (
              <span className="text-[var(--green)]">Root folder saved</span>
            ) : (
              <span className="text-[var(--txt3)]">Add root folder</span>
            )}
          </div>
          <Link href="/settings" className="mt-2 inline-block text-xs text-[var(--teal)] hover:underline">
            Open Settings →
          </Link>
        </div>
      </div>

      {driveListError && (
        <p className="mt-6 rounded-md border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-4 py-3 text-sm text-[var(--amber)]">
          {driveListError}
        </p>
      )}

      <section className="mt-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="font-medium text-[var(--txt)]">Your properties</h2>
        <p className="mt-2 text-sm text-[var(--txt3)]">
          Photos for each row load from Drive via{" "}
          <code className="text-[var(--teal)]">/api/drive/photos?folderId=…</code> (hero picker and generation wiring
          next).
        </p>
        {rows.length === 0 ? (
          <p className="mt-6 text-sm text-[var(--txt2)]">
            No properties yet. Under{" "}
            <Link href="/settings" className="text-[var(--teal)] hover:underline">
              Settings → Google Drive
            </Link>
            , set the root folder that contains one subfolder per listing (named with the address). Or sync listings
            from HubSpot when that integration is enabled.
          </p>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
                  <th className="py-3 pr-4 font-semibold">Address / folder</th>
                  <th className="py-3 pr-4 font-semibold">Source</th>
                  <th className="py-3 font-semibold">Drive folder ID</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-[var(--border)]/80 text-[var(--txt2)]">
                    <td className="py-3 pr-4 text-[var(--txt)]">{row.title}</td>
                    <td className="py-3 pr-4">
                      <span className="rounded-md border border-[var(--border2)] px-2 py-0.5 text-xs text-[var(--txt3)]">
                        {sourceLabel(row.source)}
                      </span>
                    </td>
                    <td className="py-3 font-mono text-xs text-[var(--teal)]">
                      {row.driveFolderId ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
        <h2 className="font-medium text-[var(--txt)]">Next steps</h2>
        <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-[var(--txt2)]">
          <li>
            <Link href="/settings" className="text-[var(--teal)] hover:underline">
              Settings
            </Link>
            : Drive root folder ID + optional HubSpot
          </li>
          <li>Pick a property and hero photo, then generate MLS copy, captions, and email lines (Claude integration)</li>
        </ol>
        <Link
          href="/start"
          className="mt-6 inline-block text-sm font-medium text-[var(--gold)] hover:underline"
        >
          ← Back to Start checklist
        </Link>
      </div>
    </div>
  );
}
