import Link from "next/link";
import { auth } from "@/auth";
import { MarketingPackWorkspace } from "@/components/marketing/MarketingPackWorkspace";
import type { MarketingWorkspaceRow } from "@/components/marketing/MarketingPackWorkspace";
import { type DriveFolderRef, listDriveListingFolders } from "@/lib/drive";
import { getGoogleAccessTokenForUser } from "@/lib/google-account-token";
import type { ListingFacts } from "@/lib/marketing-generate";
import { getOnboardingSnapshot } from "@/lib/onboarding";
import { buildMarketingListingRows } from "@/lib/marketing-listings";
import { prisma } from "@/lib/prisma";

function driveOnlyFacts(title: string): ListingFacts {
  return {
    address: title,
    city: "",
    state: "",
    zip: "",
    beds: null,
    baths: null,
    sqft: null,
    priceDisplay: "—",
    features: "",
    status: "Active",
    daysOnMarket: null,
  };
}

function factsFromCached(c: {
  address: string;
  city: string;
  state: string;
  zip: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  priceDisplay: string;
  features: string | null;
  status: string;
  daysOnMarket: number | null;
}): ListingFacts {
  return {
    address: c.address,
    city: c.city,
    state: c.state,
    zip: c.zip ?? "",
    beds: c.beds,
    baths: c.baths,
    sqft: c.sqft,
    priceDisplay: c.priceDisplay,
    features: c.features ?? "",
    status: c.status,
    daysOnMarket: c.daysOnMarket,
  };
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

  const [tenant, driveCfg, cachedFull] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { defaultTone: true },
    }),
    prisma.driveConfig.findUnique({
      where: { tenantId },
      select: { rootFolderId: true },
    }),
    prisma.cachedListing.findMany({
      where: { tenantId },
      orderBy: { shortAddress: "asc" },
    }),
  ]);

  const cachedSlices = cachedFull.map((c) => ({
    id: c.id,
    hubspotId: c.hubspotId,
    address: c.address,
    shortAddress: c.shortAddress,
    driveFolderId: c.driveFolderId,
  }));
  const cachedById = new Map(cachedFull.map((c) => [c.id, c]));

  let driveFolders: DriveFolderRef[] = [];
  let driveListError: string | null = null;
  const driveToken = await getGoogleAccessTokenForUser(user.id);
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

  const rows = buildMarketingListingRows(cachedSlices, driveFolders);

  const workspaceListings: MarketingWorkspaceRow[] = rows.map((row) => {
    const cached = row.cachedListingId ? cachedById.get(row.cachedListingId) : undefined;
    return {
      key: row.key,
      title: row.title,
      source: row.source,
      driveFolderId: row.driveFolderId,
      facts: cached ? factsFromCached(cached) : driveOnlyFacts(row.title),
    };
  });

  const defaultTone =
    tenant?.defaultTone ?? "Warm but professional. First-name basis. No pressure.";

  return (
    <div>
      <h1 className="font-display text-3xl text-[var(--txt)]">Listing Marketing Pack</h1>
      <p className="mt-2 max-w-2xl text-[var(--txt2)]">
        Pick a property, choose a <strong className="text-[var(--txt)]">hero photo</strong> from Drive, then generate
        MLS copy, Instagram caption, email subjects, and card line — same flow as the original demo, wired to your data.
      </p>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Properties</div>
          <div className="mt-2 font-display text-3xl text-[var(--gold)]">{snap?.listingCount ?? rows.length}</div>
          <p className="mt-2 text-xs text-[var(--txt3)]">Drive folders + CRM / Zillow rows</p>
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

      {rows.length === 0 ? (
        <section className="mt-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="font-medium text-[var(--txt)]">No properties yet</h2>
          <p className="mt-2 text-sm text-[var(--txt2)]">
            Under{" "}
            <Link href="/settings" className="text-[var(--teal)] hover:underline">
              Settings → Google Drive
            </Link>
            , set the root folder with one subfolder per listing. Or sync from HubSpot / Zillow when configured.
          </p>
        </section>
      ) : (
        <MarketingPackWorkspace listings={workspaceListings} defaultTone={defaultTone} />
      )}

      <section className="mt-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="font-medium text-[var(--txt)]">Agent-powered marketing</h2>
        <p className="mt-2 text-sm text-[var(--txt2)]">
          You can also generate marketing packs, save docs to Drive, and draft Buffer posts through the{" "}
          <Link href="/assistant" className="text-[var(--teal)] hover:underline">
            Broker Assistant
          </Link>{" "}
          agent chat. Just ask: &ldquo;Generate a marketing pack for 123 Main St&rdquo;.
        </p>
      </section>

      <Link
        href="/start"
        className="mt-10 inline-block text-sm font-medium text-[var(--gold)] hover:underline"
      >
        ← Back to Start checklist
      </Link>
    </div>
  );
}
