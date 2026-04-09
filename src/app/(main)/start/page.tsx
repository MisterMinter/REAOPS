import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getOnboardingSnapshot } from "@/lib/onboarding";
import { prisma } from "@/lib/prisma";

function Step({
  done,
  title,
  detail,
  href,
  hrefLabel,
}: {
  done: boolean;
  title: string;
  detail: string;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <li className="flex gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          done ? "bg-[var(--green)]/20 text-[var(--green)]" : "bg-[var(--border)] text-[var(--txt3)]"
        }`}
        aria-hidden
      >
        {done ? "✓" : "○"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-[var(--txt)]">{title}</div>
        <p className="mt-1 text-sm text-[var(--txt3)]">{detail}</p>
        {href && (
          <Link href={href} className="mt-2 inline-block text-sm text-[var(--teal)] hover:underline">
            {hrefLabel ?? "Open →"}
          </Link>
        )}
      </div>
    </li>
  );
}

export default async function StartPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const snap = await getOnboardingSnapshot(
    prisma,
    {
      id: session.user.id,
      role: session.user.role,
      tenantId: session.user.tenantId,
    },
    { googleTokenUserId: session.user.id }
  );

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-3xl text-[var(--txt)]">Welcome back</h1>
        <p className="mt-2 text-[var(--txt2)]">
          <span className="rounded-md bg-[var(--surface)] px-2 py-0.5 text-sm text-[var(--gold)]">
            {snap.roleLabel}
          </span>
          {snap.tenantName && (
            <>
              {" "}
              · <span className="text-[var(--txt)]">{snap.tenantName}</span>
            </>
          )}
          {snap.platformOnly && (
            <span className="text-[var(--txt3)]"> · not assigned to a brokerage workspace</span>
          )}
        </p>
      </div>

      {snap.platformOnly && (
        <section>
          <h2 className="font-display text-xl text-[var(--gold)]">Set up the platform</h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--txt2)]">
            You can manage tenants and users from Admin. To use Marketing and Assistant as a broker,
            add yourself (or a colleague) as a <strong className="text-[var(--txt)]">Broker owner</strong> on a
            tenant.
          </p>
          <ul className="mt-6 space-y-3">
            <Step
              done={snap.tenantCount > 0}
              title="Create a brokerage (tenant)"
              detail="Each brokerage gets its own HubSpot context, Drive folder, and users."
              href="/admin/tenants/new"
              hrefLabel={snap.tenantCount > 0 ? "Manage tenants →" : "New tenant →"}
            />
            <Step
              done={snap.userCount >= 2}
              title="Invite users by email"
              detail="Emails must match the Google account they will use. No self-registration."
              href="/admin/users/new"
              hrefLabel="Invite user →"
            />
            <Step
              done={snap.tenantCount > 0}
              title="Open a tenant to finish setup"
              detail="Logo, tone, Drive folder ID, and HubSpot field mapping: Admin → Tenants → Edit, or brokers use Settings."
              href="/admin/tenants"
              hrefLabel="Tenants →"
            />
          </ul>
        </section>
      )}

      {!snap.platformOnly && snap.tenantId && (
        <section>
          <h2 className="font-display text-xl text-[var(--gold)]">Your brokerage workspace</h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--txt2)]">
            Finish these so marketing and assistant are useful. Listings can come from Google Drive folders and/or
            HubSpot once sync is on.
          </p>
          <ul className="mt-6 space-y-3">
            <Step
              done={snap.hasLogo}
              title="Add your logo (recommended)"
              detail="Shows in the header and builds trust with your team."
              href="/settings"
              hrefLabel={snap.role === "AGENT" ? "View settings →" : "Open settings →"}
            />
            <Step
              done={snap.hasDriveFolder}
              title="Set the Google Drive root folder"
              detail="Folder ID from Drive — where listing photo subfolders live."
              href="/settings"
              hrefLabel={snap.role === "AGENT" ? "View settings →" : "Open settings →"}
            />
            <Step
              done={snap.hubspotConnected}
              title="Connect HubSpot"
              detail="OAuth is rolling out next. Until then, field mapping is under Admin → tenant."
              href="/settings"
              hrefLabel="Integration status →"
            />
            <Step
              done={snap.hasFlyerEmail}
              title="Set flyer notification email"
              detail="The agent sends flyer PDFs to this address by default. Also shown on marketing materials."
              href="/settings"
              hrefLabel={snap.role === "AGENT" ? "View settings →" : "Open settings →"}
            />
            <Step
              done={snap.listingCount > 0}
              title="Listings available for marketing"
              detail={
                snap.listingCount > 0
                  ? `${snap.listingCount} propert(ies) in Marketing (Drive folders and/or HubSpot). Contacts: ${snap.contactCount}.`
                  : "Add subfolders under your Drive root (one per address), or connect HubSpot when sync is available."
              }
              href="/marketing"
              hrefLabel="Marketing →"
            />
          </ul>
        </section>
      )}

      <section>
        <h2 className="font-display text-xl text-[var(--txt)]">Shortcuts</h2>
        {snap.platformOnly && (
          <p className="mt-2 text-sm text-[var(--txt3)]">
            Marketing and Assistant need a brokerage workspace. Add yourself as a broker on a tenant, then sign in again
            (or use a second user).
          </p>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/marketing"
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 transition hover:border-[var(--gold-dim)]"
          >
            <div className="text-sm font-medium text-[var(--gold)]">Listing Marketing Pack</div>
            <p className="mt-1 text-xs text-[var(--txt3)]">MLS-style copy, captions, and previews</p>
          </Link>
          <Link
            href="/assistant"
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 transition hover:border-[var(--gold-dim)]"
          >
            <div className="text-sm font-medium text-[var(--gold)]">Broker Assistant</div>
            <p className="mt-1 text-xs text-[var(--txt3)]">Chat grounded in your pipeline (when synced)</p>
          </Link>
          <Link
            href="/settings"
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 transition hover:border-[var(--gold-dim)]"
          >
            <div className="text-sm font-medium text-[var(--gold)]">Settings</div>
            <p className="mt-1 text-xs text-[var(--txt3)]">Profile, Drive folder, integration status</p>
          </Link>
          {session.user.role === "ADMIN" && (
            <Link
              href="/admin/tenants"
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 transition hover:border-[var(--gold-dim)]"
            >
              <div className="text-sm font-medium text-[var(--teal)]">Admin</div>
              <p className="mt-1 text-xs text-[var(--txt3)]">Tenants, users, field mapping</p>
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
