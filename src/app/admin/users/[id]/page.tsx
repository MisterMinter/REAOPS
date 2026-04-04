import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteUser, updateUser } from "@/app/admin/_actions/users";
import { DeleteUserButton } from "@/app/admin/users/delete-user-button";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export default async function EditUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const session = await auth();

  const user = await prisma.user.findUnique({
    where: { id },
    include: { tenant: { select: { name: true } } },
  });
  if (!user) notFound();

  const tenants = await prisma.tenant.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const isSelf = session?.user?.id === user.id;

  const err = q.error;
  const errorMsg =
    err === "email"
      ? "Email is required."
      : err === "admin-tenant"
        ? "Admin users cannot be assigned to a tenant."
        : err === "tenant"
          ? "Broker owner and agent roles require a tenant."
          : err === "self-demote"
            ? "You cannot remove your own platform admin role."
            : err === "last-admin"
              ? "Cannot demote the only platform admin."
              : err === "email-taken"
                ? "Another user already has that email."
                : null;

  return (
    <div>
      <Link href="/admin/users" className="text-sm text-[var(--txt3)] hover:text-[var(--gold)]">
        ← Users
      </Link>
      <h1 className="mt-4 font-display text-3xl text-[var(--txt)]">Edit user</h1>
      <p className="mt-1 text-sm text-[var(--txt3)]">{user.email}</p>

      {q.saved && <p className="mt-4 text-sm text-[var(--green)]">Saved.</p>}
      {errorMsg && <p className="mt-4 text-sm text-[var(--coral)]">{errorMsg}</p>}

      <form action={updateUser} className="mt-8 max-w-lg space-y-4">
        <input type="hidden" name="userId" value={user.id} />
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Email</label>
          <input
            name="email"
            type="email"
            required
            defaultValue={user.email}
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)]"
          />
          <p className="mt-1 text-xs text-[var(--txt3)]">
            Must match the Google account they use to sign in (after you save).
          </p>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">
            Display name (optional)
          </label>
          <input
            name="name"
            defaultValue={user.name ?? ""}
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Role</label>
          {isSelf ? (
            <>
              <input type="hidden" name="role" value={user.role} />
              <div className="mt-1 rounded-md border border-[var(--border)] bg-[var(--surface)]/60 px-3 py-2 text-[var(--txt2)]">
                {user.role}
              </div>
              <p className="mt-1 text-xs text-[var(--txt3)]">Ask another admin to change your role.</p>
            </>
          ) : (
            <select
              name="role"
              defaultValue={user.role}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)]"
            >
              <option value="ADMIN">Admin (platform)</option>
              <option value="BROKER_OWNER">Broker owner</option>
              <option value="AGENT">Agent</option>
            </select>
          )}
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Tenant</label>
          {isSelf ? (
            <>
              <input type="hidden" name="tenantId" value={user.tenantId ?? ""} />
              <div className="mt-1 rounded-md border border-[var(--border)] bg-[var(--surface)]/60 px-3 py-2 text-[var(--txt2)]">
                {user.tenant ? user.tenant.name : "— None (platform admin) —"}
              </div>
              <p className="mt-1 text-xs text-[var(--txt3)]">Another admin can move you to a brokerage.</p>
            </>
          ) : (
            <select
              name="tenantId"
              defaultValue={user.tenantId ?? ""}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--txt)]"
            >
              <option value="">— None (admin only) —</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <button
          type="submit"
          className="rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--bg)]"
        >
          Save changes
        </button>
      </form>

      <section className="mt-14 max-w-lg border-t border-[var(--border)] pt-10">
        <h2 className="font-display text-lg text-[var(--coral)]">Remove user</h2>
        <p className="mt-2 text-sm text-[var(--txt3)]">
          Deletes the user and their OAuth account links. They will not be able to sign in until invited again.
        </p>
        {isSelf ? (
          <p className="mt-4 text-sm text-[var(--txt3)]">You cannot remove your own account.</p>
        ) : (
          <div className="mt-4">
            <DeleteUserButton userId={user.id} />
          </div>
        )}
      </section>
    </div>
  );
}
