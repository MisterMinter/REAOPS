import Link from "next/link";
import type { Session } from "next-auth";
import type { UserRole } from "@prisma/client";
import { SignOutButton } from "@/components/shell/sign-out-button";

const ROLE_SHORT: Record<UserRole, string> = {
  ADMIN: "Admin",
  BROKER_OWNER: "Broker",
  AGENT: "Agent",
};

export type TopbarTenant = {
  displayName: string;
  logoUrl: string | null;
};

export function Topbar({
  session,
  tenant,
}: {
  session: Session | null;
  tenant?: TopbarTenant | null;
}) {
  const user = session?.user;
  if (!user) return null;

  const role = "role" in user ? user.role : undefined;

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--bg)]/92 px-4 backdrop-blur-md sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/start" className="flex min-w-0 items-center gap-3">
          {tenant?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tenant.logoUrl}
              alt=""
              className="h-9 w-9 shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface)] object-contain p-0.5"
            />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--gold-dim)] bg-[var(--surface)] text-xs font-bold text-[var(--gold)]">
              RE
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate font-display text-lg font-semibold tracking-wide text-[var(--gold)]">
              RE Agent OS
            </div>
            <div className="truncate text-xs text-[var(--txt3)]">
              {tenant?.displayName && <span className="text-[var(--txt2)]">{tenant.displayName} · </span>}
              {user.name || user.email}
              {role && (
                <span className="text-[var(--txt3)]"> · {ROLE_SHORT[role as UserRole]}</span>
              )}
            </div>
          </div>
        </Link>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {role === "ADMIN" && (
          <Link
            href="/admin/tenants"
            className="text-xs font-medium uppercase tracking-wider text-[var(--txt3)] hover:text-[var(--gold)]"
          >
            Admin
          </Link>
        )}
        <SignOutButton />
      </div>
    </header>
  );
}
