import Link from "next/link";
import { setUserActiveFromForm } from "@/app/admin/_actions/users";
import { prisma } from "@/lib/prisma";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; deleted?: string }>;
}) {
  const q = await searchParams;
  const users = await prisma.user.findMany({
    orderBy: { email: "asc" },
    include: { tenant: { select: { name: true, slug: true } } },
  });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-3xl text-[var(--txt)]">Users</h1>
        <Link
          href="/admin/users/new"
          className="rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--bg)]"
        >
          Invite user
        </Link>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-[var(--txt3)]">
        Google sign-in only works after a user row exists with a matching email. Add users here before they sign in
        for the first time.
      </p>
      {q.deleted && <p className="mt-4 text-sm text-[var(--green)]">User removed.</p>}
      {q.error === "user" && (
        <p className="mt-4 text-sm text-[var(--coral)]">Missing user id.</p>
      )}
      {q.error === "self-deactivate" && (
        <p className="mt-4 text-sm text-[var(--coral)]">You cannot deactivate your own account.</p>
      )}
      {q.error === "self-delete" && (
        <p className="mt-4 text-sm text-[var(--coral)]">You cannot delete your own account.</p>
      )}
      {q.error === "last-admin-delete" && (
        <p className="mt-4 text-sm text-[var(--coral)]">Cannot delete the only platform admin.</p>
      )}
      <ul className="mt-8 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--card)]">
        {users.length === 0 && (
          <li className="px-4 py-8 text-center text-[var(--txt3)]">No users yet. Seed the first admin or add one.</li>
        )}
        {users.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="truncate font-medium text-[var(--txt)]">{u.email}</div>
              <div className="text-xs text-[var(--txt3)]">
                {u.role}
                {u.tenant ? ` · ${u.tenant.name}` : ""}
                {u.isActive ? "" : " · inactive"}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link
                href={`/admin/users/${u.id}`}
                className="rounded-md border border-[var(--border2)] px-3 py-1.5 text-xs text-[var(--teal)] hover:border-[var(--gold)]"
              >
                Edit
              </Link>
              <form action={setUserActiveFromForm} className="inline">
                <input type="hidden" name="userId" value={u.id} />
                <input type="hidden" name="isActive" value={u.isActive ? "false" : "true"} />
                <button
                  type="submit"
                  className="rounded-md border border-[var(--border2)] px-3 py-1.5 text-xs text-[var(--txt)] hover:border-[var(--gold)]"
                >
                  {u.isActive ? "Deactivate" : "Activate"}
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
