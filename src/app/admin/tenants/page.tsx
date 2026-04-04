import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function AdminTenantsPage() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { users: true } } },
  });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-3xl text-[var(--txt)]">Tenants</h1>
        <Link
          href="/admin/tenants/new"
          className="rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--bg)]"
        >
          New tenant
        </Link>
      </div>
      <ul className="mt-8 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--card)]">
        {tenants.length === 0 && (
          <li className="px-4 py-10 text-center">
            <p className="text-[var(--txt2)]">No brokerages yet. Create one, then invite users with matching Google emails.</p>
            <Link
              href="/admin/tenants/new"
              className="mt-4 inline-block rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--bg)]"
            >
              Create first tenant
            </Link>
            <p className="mt-6 text-xs text-[var(--txt3)]">
              Next:{" "}
              <Link href="/admin/users/new" className="text-[var(--teal)] hover:underline">
                Admin → Users → Invite user
              </Link>
            </p>
          </li>
        )}
        {tenants.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <Link href={`/admin/tenants/${t.id}`} className="font-medium text-[var(--txt)] hover:text-[var(--gold)]">
                {t.name}
              </Link>
              <div className="text-xs text-[var(--txt3)]">
                {t.slug} · {t._count.users} user(s) · {t.isActive ? "active" : "inactive"}
              </div>
            </div>
            <Link href={`/admin/tenants/${t.id}`} className="text-sm text-[var(--teal)]">
              Edit
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
