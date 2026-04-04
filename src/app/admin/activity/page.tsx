import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function AdminActivityPage() {
  const logs = await prisma.activityLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      tenant: { select: { name: true, slug: true } },
      user: { select: { email: true } },
    },
  });

  return (
    <div>
      <h1 className="font-display text-3xl text-[var(--txt)]">Activity</h1>
      <p className="mt-2 text-sm text-[var(--txt3)]">
        Audit trail (populated as integrations write to <code className="text-[var(--teal)]">ActivityLog</code>). V1
        stubs only — most actions will appear after HubSpot and Drive sync ship.
      </p>
      <ul className="mt-8 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--card)]">
        {logs.length === 0 && (
          <li className="px-4 py-8 text-center text-[var(--txt3)]">No activity yet.</li>
        )}
        {logs.map((log) => (
          <li key={log.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-[var(--txt)]">{log.action}</span>
              <time className="text-xs text-[var(--txt3)]" dateTime={log.createdAt.toISOString()}>
                {log.createdAt.toLocaleString()}
              </time>
            </div>
            <div className="mt-1 text-xs text-[var(--txt3)]">
              {log.tenant.name}
              {log.user?.email ? ` · ${log.user.email}` : ""}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm">
        <Link href="/admin/tenants" className="text-[var(--teal)] hover:underline">
          ← Back to tenants
        </Link>
      </p>
    </div>
  );
}
