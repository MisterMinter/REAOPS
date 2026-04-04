import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  updateDriveRootFolder,
  updateTenantProfile,
  uploadTenantLogoFromSettings,
} from "@/app/(main)/settings/_actions";
import { SettingsForms } from "@/app/(main)/settings/settings-forms";
import { hasLegacyRelativeLogoPath, resolveTenantLogoForDisplay } from "@/lib/tenant-logo";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const q = await searchParams;
  const session = await auth();
  const user = session?.user;

  if (!user) {
    return null;
  }

  const noTenant = !user.tenantId;
  const canEdit = user.role === "BROKER_OWNER" || user.role === "ADMIN";
  const readOnly = Boolean(user.tenantId && user.role === "AGENT");

  const tenant = user.tenantId
    ? await prisma.tenant.findUnique({
        where: { id: user.tenantId },
        include: {
          hubspotTokens: { select: { id: true, hubId: true, updatedAt: true } },
          bufferTokens: { select: { id: true, updatedAt: true } },
          driveConfig: { select: { rootFolderId: true, updatedAt: true } },
        },
      })
    : null;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-3xl text-[var(--txt)]">Settings</h1>
        <p className="mt-2 max-w-2xl text-[var(--txt2)]">
          Brokerage profile, Google Drive listing photos folder, and integration status. HubSpot and
          Buffer OAuth routes ship next; you can still prepare Drive and branding here.
        </p>
      </div>

      {noTenant && (
        <section className="rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/5 p-6">
          <h2 className="font-display text-xl text-[var(--amber)]">No brokerage assigned</h2>
          <p className="mt-2 text-sm text-[var(--txt2)]">
            Your account is not linked to a tenant yet. Platform admins should create a tenant under{" "}
            <Link href="/admin/tenants" className="text-[var(--teal)] hover:underline">
              Admin → Tenants
            </Link>
            , then add you as a user with that tenant and role{" "}
            <strong className="text-[var(--txt)]">Broker owner</strong> or{" "}
            <strong className="text-[var(--txt)]">Agent</strong>.
          </p>
          {user.role === "ADMIN" && (
            <ul className="mt-4 list-inside list-disc text-sm text-[var(--txt3)]">
              <li>Create the brokerage: Admin → Tenants → New tenant</li>
              <li>
                Add yourself (or the broker) under Admin → Users with the new tenant selected — not
                &quot;Admin (platform)&quot; if you need marketing &amp; assistant for that brokerage
              </li>
              <li>
                Optional: keep a separate platform admin login without <code className="text-[var(--teal)]">tenantId</code>{" "}
                for onboarding only
              </li>
            </ul>
          )}
        </section>
      )}

      {q.saved === "logo" && (
        <p className="rounded-md border border-[var(--green)]/40 bg-[var(--green)]/10 px-4 py-3 text-sm text-[var(--green)]">
          Logo saved.
        </p>
      )}
      {q.error === "logo-invalid" && (
        <p className="rounded-md border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-sm text-[var(--coral)]">
          Logo must be PNG, JPEG, WebP, or GIF and under ~400KB.
        </p>
      )}
      {q.error === "logo-no-file" && (
        <p className="rounded-md border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-sm text-[var(--coral)]">
          Choose an image file before uploading.
        </p>
      )}

      {tenant && (
        <SettingsForms
          tenant={{
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            brokerageName: tenant.brokerageName,
            defaultTone: tenant.defaultTone,
            logoUrl: tenant.logoUrl,
            hubspotListingObject: tenant.hubspotListingObject,
          }}
          logoPreviewUrl={resolveTenantLogoForDisplay(tenant.logoUrl)}
          legacyRelativeLogo={hasLegacyRelativeLogoPath(tenant.logoUrl)}
          driveRootFolderId={tenant.driveConfig?.rootFolderId ?? ""}
          hubspotConnected={!!tenant.hubspotTokens}
          hubspotHubId={tenant.hubspotTokens?.hubId ?? null}
          hubspotUpdatedAt={tenant.hubspotTokens?.updatedAt ?? null}
          bufferConnected={!!tenant.bufferTokens}
          bufferUpdatedAt={tenant.bufferTokens?.updatedAt ?? null}
          canEdit={canEdit}
          readOnly={readOnly}
          isAdmin={user.role === "ADMIN"}
          updateProfile={updateTenantProfile}
          updateDrive={updateDriveRootFolder}
          uploadLogo={uploadTenantLogoFromSettings}
        />
      )}

      {tenant && user.role === "ADMIN" && (
        <p className="text-sm text-[var(--txt3)]">
          HubSpot field mapping and full tenant record:{" "}
          <Link href={`/admin/tenants/${tenant.id}`} className="text-[var(--teal)] hover:underline">
            Admin → Tenants → {tenant.name}
          </Link>
        </p>
      )}
    </div>
  );
}
