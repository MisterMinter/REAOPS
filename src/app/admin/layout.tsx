import Link from "next/link";

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-10 min-h-screen">
      <header className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4">
          <Link href="/marketing" className="text-sm text-[var(--txt3)] hover:text-[var(--gold)]">
            ← App
          </Link>
          <span className="text-xs font-semibold uppercase tracking-widest text-[var(--gold)]">Admin</span>
          <nav className="flex flex-wrap gap-4 text-sm">
            <Link href="/admin/tenants" className="text-[var(--txt2)] hover:text-[var(--txt)]">
              Tenants
            </Link>
            <Link href="/admin/users" className="text-[var(--txt2)] hover:text-[var(--txt)]">
              Users
            </Link>
            <Link href="/admin/activity" className="text-[var(--txt2)] hover:text-[var(--txt)]">
              Activity
            </Link>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}
