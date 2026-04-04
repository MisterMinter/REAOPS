import Link from "next/link";
import { auth } from "@/auth";
import { getOnboardingSnapshot } from "@/lib/onboarding";
import { prisma } from "@/lib/prisma";

export default async function MarketingPage() {
  const session = await auth();
  const user = session?.user;
  const snap = user?.id
    ? await getOnboardingSnapshot(prisma, {
        id: user.id,
        role: user.role,
        tenantId: user.tenantId,
      })
    : null;

  if (!user?.tenantId) {
    return (
      <div>
        <h1 className="font-display text-3xl text-[var(--txt)]">Listing Marketing Pack</h1>
        <p className="mt-2 max-w-2xl text-[var(--txt2)]">
          Select listings, photos, and generate MLS descriptions, captions, and email lines — once your brokerage is
          connected to HubSpot and Drive.
        </p>
        <div className="mt-8 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/5 p-6">
          <p className="text-sm text-[var(--txt2)]">
            You are not assigned to a brokerage yet. Open <Link href="/start" className="text-[var(--teal)] hover:underline">Start</Link>{" "}
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

  return (
    <div>
      <h1 className="font-display text-3xl text-[var(--txt)]">Listing Marketing Pack</h1>
      <p className="mt-2 max-w-2xl text-[var(--txt2)]">
        Pull listings from HubSpot, pick photos from Drive, generate copy with Claude — end-to-end wiring is in
        progress.
      </p>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Listings in app</div>
          <div className="mt-2 font-display text-3xl text-[var(--gold)]">{snap?.listingCount ?? 0}</div>
          <p className="mt-2 text-xs text-[var(--txt3)]">From HubSpot after sync is enabled</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">HubSpot</div>
          <div className="mt-2 text-sm font-medium text-[var(--txt)]">
            {snap?.hubspotConnected ? (
              <span className="text-[var(--green)]">Connected</span>
            ) : (
              <span className="text-[var(--txt3)]">Not connected</span>
            )}
          </div>
          <Link href="/settings" className="mt-2 inline-block text-xs text-[var(--teal)] hover:underline">
            Status in Settings →
          </Link>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Drive photos</div>
          <div className="mt-2 text-sm font-medium text-[var(--txt)]">
            {snap?.hasDriveFolder ? (
              <span className="text-[var(--green)]">Folder ID saved</span>
            ) : (
              <span className="text-[var(--txt3)]">Add root folder</span>
            )}
          </div>
          <Link href="/settings" className="mt-2 inline-block text-xs text-[var(--teal)] hover:underline">
            Open Settings →
          </Link>
        </div>
      </div>

      <div className="mt-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="font-medium text-[var(--txt)]">What happens next</h2>
        <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-[var(--txt2)]">
          <li>
            <Link href="/settings" className="text-[var(--teal)] hover:underline">
              Settings
            </Link>
            : Drive folder + HubSpot OAuth (when live)
          </li>
          <li>Listings sync into this workspace; you pick a property and hero photo</li>
          <li>Generate MLS description, Instagram caption, email subjects, and card copy in one run</li>
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
