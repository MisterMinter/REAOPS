import Link from "next/link";
import { notFound } from "next/navigation";
import { uploadTenantLogoAction, updateTenant } from "@/app/admin/_actions/tenants";
import { DEFAULT_DEAL_MAPPING } from "@/lib/hubspot-mapping";
import { prisma } from "@/lib/prisma";
import { hasLegacyRelativeLogoPath, resolveTenantLogoForDisplay } from "@/lib/tenant-logo";

export default async function EditTenantPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) notFound();

  const mappingJson = JSON.stringify(
    (tenant.hubspotListingProps as object) ?? DEFAULT_DEAL_MAPPING,
    null,
    2
  );

  const boundUpdate = updateTenant.bind(null, tenant.id);
  const boundLogo = uploadTenantLogoAction.bind(null, tenant.id);
  const logoPreview = resolveTenantLogoForDisplay(tenant.logoUrl);
  const legacyLogo = hasLegacyRelativeLogoPath(tenant.logoUrl);

  return (
    <div>
      <Link href="/admin/tenants" className="text-sm text-[var(--txt3)] hover:text-[var(--gold)]">
        ← Tenants
      </Link>
      <h1 className="mt-4 font-display text-3xl text-[var(--txt)]">{tenant.name}</h1>
      <p className="text-sm text-[var(--txt3)]">{tenant.slug}</p>

      {q.saved === "1" && <p className="mt-4 text-sm text-[var(--green)]">Saved.</p>}
      {q.saved === "logo" && <p className="mt-4 text-sm text-[var(--green)]">Logo updated.</p>}
      {q.error === "invalid-json" && (
        <p className="mt-4 text-sm text-[var(--coral)]">HubSpot mapping must be valid JSON.</p>
      )}
      {q.error === "no-file" && <p className="mt-4 text-sm text-[var(--coral)]">Choose an image file.</p>}
      {q.error === "logo-invalid" && (
        <p className="mt-4 text-sm text-[var(--coral)]">
          Logo must be PNG, JPEG, WebP, or GIF and under ~400KB.
        </p>
      )}

      <section className="mt-10 max-w-2xl">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--txt3)]">Broker logo</h2>
        {legacyLogo && (
          <p className="mt-2 text-sm text-[var(--amber)]">
            Old logo path no longer resolves on this server — upload again (logos are now stored in the database).
          </p>
        )}
        {logoPreview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoPreview} alt="" className="mt-2 h-16 w-auto object-contain" />
        )}
        <form action={boundLogo} encType="multipart/form-data" className="mt-4 flex flex-wrap items-end gap-4">
          <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/gif" required />
          <button type="submit" className="rounded-md border border-[var(--border2)] px-3 py-2 text-sm text-[var(--txt)]">
            Upload logo
          </button>
        </form>
        <p className="mt-2 text-xs text-[var(--txt3)]">
          Logos are stored in the database (data URL). Max ~400KB.
        </p>
      </section>

      <form action={boundUpdate} className="mt-10 max-w-2xl space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Name</label>
          <input
            name="name"
            required
            defaultValue={tenant.name}
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
            Brokerage display name
          </label>
          <input
            name="brokerageName"
            defaultValue={tenant.brokerageName ?? ""}
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
            Broker phone
          </label>
          <input
            name="brokerPhone"
            defaultValue={tenant.brokerPhone ?? ""}
            placeholder="(555) 123-4567"
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
            Flyer notification email
          </label>
          <input
            name="flyerNotifyEmail"
            type="email"
            defaultValue={tenant.flyerNotifyEmail ?? ""}
            placeholder="contracts@brokerage.com"
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)]"
          />
          <p className="mt-1 text-xs text-[var(--txt3)]">
            Default recipient for flyer PDFs. The agent uses this when no email is specified.
          </p>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
            Default tone (marketing)
          </label>
          <textarea
            name="defaultTone"
            rows={3}
            defaultValue={tenant.defaultTone}
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
            HubSpot listing object
          </label>
          <input
            name="hubspotListingObject"
            defaultValue={tenant.hubspotListingObject}
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm text-[var(--txt)]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
            HubSpot field mapping (JSON)
          </label>
          <textarea
            name="hubspotListingProps"
            rows={14}
            defaultValue={mappingJson}
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--txt)]"
          />
        </div>
        <button type="submit" className="rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--bg)]">
          Save tenant
        </button>
      </form>
    </div>
  );
}
