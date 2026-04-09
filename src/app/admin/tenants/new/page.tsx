import Link from "next/link";
import { createTenant } from "@/app/admin/_actions/tenants";

export default async function NewTenantPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <div>
      <Link href="/admin/tenants" className="text-sm text-[var(--txt3)] hover:text-[var(--gold)]">
        ← Tenants
      </Link>
      <h1 className="mt-4 font-display text-3xl text-[var(--txt)]">New tenant</h1>
      {params.error === "missing-name" && (
        <p className="mt-2 text-sm text-[var(--coral)]">Name is required.</p>
      )}
      <form action={createTenant} className="mt-8 max-w-lg space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
            Brokerage / tenant name
          </label>
          <input
            name="name"
            required
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
            Slug (optional — auto from name)
          </label>
          <input
            name="slug"
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)]"
            placeholder="atlanta-premier"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
            Display name (optional)
          </label>
          <input
            name="brokerageName"
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
            Broker phone (optional)
          </label>
          <input
            name="brokerPhone"
            placeholder="(555) 123-4567"
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
            Flyer notification email (optional)
          </label>
          <input
            name="flyerNotifyEmail"
            type="email"
            placeholder="contracts@brokerage.com"
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)]"
          />
          <p className="mt-1 text-xs text-[var(--txt3)]">
            Default recipient for flyer emails. Brokers can change this in Settings.
          </p>
        </div>
        <button
          type="submit"
          className="rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--bg)]"
        >
          Create tenant
        </button>
      </form>
    </div>
  );
}
