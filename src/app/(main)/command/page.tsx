import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { buildOpsCommandCenter, contactDisplayName } from "@/lib/ops/workflows";

function dateLabel(d: Date | null) {
  if (!d) return "No due date";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function CommandCenterPage() {
  const session = await auth();
  const user = session?.user;

  if (!user?.tenantId) {
    return (
      <div>
        <h1 className="font-display text-3xl text-[var(--txt)]">Command Center</h1>
        <p className="mt-2 text-[var(--txt2)]">Assign your user to a brokerage to use the operations ledger.</p>
      </div>
    );
  }

  const data = await buildOpsCommandCenter(prisma, user.tenantId);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl text-[var(--txt)]">Command Center</h1>
        <p className="mt-2 max-w-3xl text-[var(--txt2)]">
          Daily brokerage operations: revenue recovery, approvals, stale contacts, compliance blockers, and marketing
          work. Chat actions now create records here so nothing disappears into a conversation.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Open follow-ups" value={data.openTasks.length} tone="gold" />
        <Metric label="Pending approvals" value={data.approvals.length} tone="amber" />
        <Metric label="Stale contacts" value={data.staleContacts.length} tone="coral" />
        <Metric label="Drafts awaiting review" value={data.waitingDraftCount} tone="teal" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl text-[var(--gold)]">Revenue Recovery</h2>
            <Link href="/follow-up" className="text-sm text-[var(--teal)] hover:underline">
              Open queue
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {data.openTasks.length === 0 ? (
              <p className="text-sm text-[var(--txt3)]">No open follow-up tasks yet.</p>
            ) : (
              data.openTasks.map((task) => (
                <div key={task.id} className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-[var(--txt)]">{task.title}</div>
                      <div className="mt-1 text-xs text-[var(--txt3)]">
                        {task.contact ? contactDisplayName(task.contact) : "No contact"} · {task.status} · {task.risk}
                      </div>
                    </div>
                    <span className="text-xs text-[var(--amber)]">{dateLabel(task.dueAt)}</span>
                  </div>
                  {task.context && <p className="mt-2 line-clamp-2 text-sm text-[var(--txt2)]">{task.context}</p>}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl text-[var(--gold)]">Approvals</h2>
            <Link href="/follow-up" className="text-sm text-[var(--teal)] hover:underline">
              Review drafts
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {data.approvals.length === 0 ? (
              <p className="text-sm text-[var(--txt3)]">No drafts waiting on approval.</p>
            ) : (
              data.approvals.map((approval) => (
                <div key={approval.id} className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="font-medium text-[var(--txt)]">
                    {approval.draft?.subject ?? approval.task?.title ?? "Draft approval"}
                  </div>
                  <div className="mt-1 text-xs text-[var(--txt3)]">
                    {approval.draft?.contact ? contactDisplayName(approval.draft.contact) : "No contact"} ·{" "}
                    {approval.draft?.channel ?? "channel"} · {approval.draft?.risk ?? "risk"}
                  </div>
                  {approval.draft?.body && <p className="mt-2 line-clamp-2 text-sm text-[var(--txt2)]">{approval.draft.body}</p>}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl text-[var(--gold)]">Stale Contacts</h2>
            <Link href="/contacts" className="text-sm text-[var(--teal)] hover:underline">
              Open contacts
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {data.staleContacts.length === 0 ? (
              <p className="text-sm text-[var(--txt3)]">Everyone has been touched recently.</p>
            ) : (
              data.staleContacts.map((contact) => (
                <div key={contact.id} className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="font-medium text-[var(--txt)]">{contactDisplayName(contact)}</div>
                  <div className="mt-1 text-xs text-[var(--txt3)]">
                    {contact.leadSource?.name ?? "Unknown source"} · last touch{" "}
                    {contact.lastContactAt ? contact.lastContactAt.toLocaleDateString() : "never"}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl text-[var(--gold)]">Marketing & Compliance</h2>
            <div className="flex gap-3 text-sm">
              <Link href="/marketing" className="text-[var(--teal)] hover:underline">
                Marketing
              </Link>
              <Link href="/compliance" className="text-[var(--teal)] hover:underline">
                Compliance
              </Link>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {data.marketingAssets.slice(0, 3).map((asset) => (
              <div key={asset.id} className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="font-medium text-[var(--txt)]">{asset.title}</div>
                <div className="mt-1 text-xs text-[var(--txt3)]">{asset.type} · {asset.status}</div>
              </div>
            ))}
            {data.complianceReviews.slice(0, 3).map((review) => (
              <div key={review.id} className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="font-medium text-[var(--txt)]">{review.title}</div>
                <div className="mt-1 text-xs text-[var(--txt3)]">Compliance · {review.status}</div>
              </div>
            ))}
            {data.marketingAssets.length === 0 && data.complianceReviews.length === 0 && (
              <p className="text-sm text-[var(--txt3)]">No marketing or compliance blockers yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "gold" | "amber" | "coral" | "teal" }) {
  const color =
    tone === "gold"
      ? "text-[var(--gold)]"
      : tone === "amber"
        ? "text-[var(--amber)]"
        : tone === "coral"
          ? "text-[var(--coral)]"
          : "text-[var(--teal)]";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">{label}</div>
      <div className={`mt-2 font-display text-3xl ${color}`}>{value}</div>
    </div>
  );
}
