import Link from "next/link";
import type { Session } from "next-auth";
import { SignOutButton } from "@/components/shell/sign-out-button";

export function Topbar({ session }: { session: Session | null }) {
  const user = session?.user;
  if (!user) return null;

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--bg)]/92 px-4 backdrop-blur-md sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/marketing" className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--gold-dim)] bg-[var(--surface)] text-xs font-bold text-[var(--gold)]">
            RE
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-lg font-semibold tracking-wide text-[var(--gold)]">
              RE Agent OS
            </div>
            {user.name && (
              <div className="truncate text-xs text-[var(--txt3)]">{user.name}</div>
            )}
          </div>
        </Link>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {"role" in user && user.role === "ADMIN" && (
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
