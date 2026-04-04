import Link from "next/link";
import { createUser } from "@/app/admin/_actions/users";
import { prisma } from "@/lib/prisma";

export default async function NewUserPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const tenants = await prisma.tenant.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  return (
    <div>
      <Link href="/admin/users" className="text-sm text-[var(--txt3)] hover:text-[var(--gold)]">
        ← Users
      </Link>
      <h1 className="mt-4 font-display text-3xl text-[var(--txt)]">Invite user</h1>
      {params.error === "email" && (
        <p className="mt-2 text-sm text-[var(--coral)]">Email is required.</p>
      )}
      {params.error === "admin-tenant" && (
        <p className="mt-2 text-sm text-[var(--coral)]">Admin users cannot be assigned to a tenant.</p>
      )}
      {params.error === "tenant" && (
        <p className="mt-2 text-sm text-[var(--coral)]">Broker owner and agent roles require a tenant.</p>
      )}
      <form action={createUser} className="mt-8 max-w-lg space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Email</label>
          <input
            name="email"
            type="email"
            required
            autoComplete="off"
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)]"
            placeholder="name@brokerage.com"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
            Display name (optional)
          </label>
          <input
            name="name"
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Role</label>
          <select
            name="role"
            defaultValue="AGENT"
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)]"
          >
            <option value="ADMIN">Admin (platform)</option>
            <option value="BROKER_OWNER">Broker owner</option>
            <option value="AGENT">Agent</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Tenant</label>
          <select
            name="tenantId"
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)]"
          >
            <option value="">— None (admin only) —</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--txt3)]">Leave empty for platform admins.</p>
        </div>
        <button
          type="submit"
          className="rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--bg)]"
        >
          Create user
        </button>
      </form>
    </div>
  );
}
