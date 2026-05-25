import Link from "next/link";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireActiveUser } from "@/lib/session-guard";
import { getTenantPortalSnapshot, type PortalHealthItem } from "@/lib/tenant-portal";
import {
  createTenantMemberAction,
  runTenantMemoryBackfillAction,
  runTenantMemoryMaintenanceAction,
  setTenantMemberActiveAction,
} from "@/app/(main)/start/_actions";

function statusClass(status: PortalHealthItem["status"]) {
  if (status === "ready") return "border-[var(--green)]/40 bg-[var(--green)]/10 text-[var(--green)]";
  if (status === "blocked") return "border-[var(--coral)]/40 bg-[var(--coral)]/10 text-[var(--coral)]";
  return "border-[var(--amber)]/40 bg-[var(--amber)]/10 text-[var(--amber)]";
}

function statusLabel(status: PortalHealthItem["status"]) {
  if (status === "ready") return "Ready";
  if (status === "blocked") return "Blocked";
  return "Needs attention";
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "Never";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString();
}

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const query = await searchParams;
  const user = await requireActiveUser().catch(() => null);
  if (!user) redirect("/login");

  const snapshot = await getTenantPortalSnapshot(prisma, user);

  if (snapshot.platformOnly) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="font-display text-3xl text-[var(--txt)]">Platform setup</h1>
          <p className="mt-2 max-w-2xl text-[var(--txt2)]">
            Create a brokerage workspace, then add broker owners and agents with matching Google emails.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Metric label="Tenants" value={snapshot.tenantCount} />
          <Metric label="Users" value={snapshot.userCount} />
          <Metric label="Mode" value="Admin" />
        </div>
        <div className="flex flex-wrap gap-3">
          <LinkButton href="/admin/tenants/new">New tenant</LinkButton>
          <LinkButton href="/admin/users/new">New user</LinkButton>
          <LinkButton href="/admin/tenants">Manage tenants</LinkButton>
        </div>
      </div>
    );
  }

  const memoryGaps = snapshot.memory.providerGaps.gaps.slice(0, 6);
  const staleFacts = [
    ...snapshot.memory.providerGaps.stale,
    ...snapshot.memory.localStaleFacts,
  ].slice(0, 8);
  const memoryStatus =
    snapshot.memory.health.ok && snapshot.memory.health.configured && snapshot.memory.isolation.status !== "failed"
      ? "ready"
      : snapshot.memory.isolation.status === "failed"
        ? "blocked"
        : "warning";

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-[var(--gold)]">Tenant portal</p>
          <h1 className="mt-2 font-display text-3xl text-[var(--txt)]">{snapshot.tenant.name}</h1>
          <p className="mt-2 max-w-2xl text-[var(--txt2)]">
            Go-live readiness, member access, integrations, memory status, review queue, and autonomous run history.
          </p>
        </div>
        <div className={`rounded-lg border px-4 py-3 ${snapshot.goLive.ready ? statusClass("ready") : statusClass(snapshot.goLive.blocking > 0 ? "blocked" : "warning")}`}>
          <div className="text-xs font-semibold uppercase tracking-wider">Go-live readiness</div>
          <div className="mt-1 text-2xl font-semibold">
            {snapshot.goLive.ready ? "Ready" : `${snapshot.goLive.blocking} blocked / ${snapshot.goLive.warnings} warning`}
          </div>
        </div>
      </div>

      {query.saved && (
        <p className="rounded-md border border-[var(--green)]/40 bg-[var(--green)]/10 px-4 py-3 text-sm text-[var(--green)]">
          Saved.
        </p>
      )}
      {query.error && (
        <p className="rounded-md border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-sm text-[var(--coral)]">
          {errorText(query.error)}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Pending approvals" value={snapshot.metrics.pendingApprovals} href="/follow-up" />
        <Metric label="Compliance items" value={snapshot.metrics.openCompliance} href="/compliance" />
        <Metric label="Notifications" value={snapshot.metrics.unreadNotifications} href="/command" />
        <Metric label="Approval mode" value={snapshot.tenant.approvalMode.replace(/_/g, " ")} href="/settings" />
      </div>

      <section>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-xl text-[var(--gold)]">Workspace Health</h2>
            <p className="mt-1 text-sm text-[var(--txt3)]">Required checks gate autonomous send/publish behavior.</p>
          </div>
          <Link href="/settings" className="text-sm text-[var(--teal)] hover:underline">
            Settings -&gt;
          </Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {snapshot.healthItems.map((item) => (
            <div key={item.key} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-[var(--txt)]">{item.label}</h3>
                  <p className="mt-1 text-sm text-[var(--txt3)]">{item.detail}</p>
                </div>
                <span className={`shrink-0 rounded-md border px-2 py-1 text-xs ${statusClass(item.status)}`}>
                  {statusLabel(item.status)}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--txt3)]">
                <span>{item.requiredForGoLive ? "Required" : "Optional"}</span>
                {item.href && (
                  <Link href={item.href} className="text-[var(--teal)] hover:underline">
                    Open
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-display text-xl text-[var(--gold)]">GBrain Memory</h2>
              <p className="mt-1 text-sm text-[var(--txt3)]">
                Last sync, backfill controls, citations, stale facts, and tenant isolation status.
              </p>
            </div>
            <span className={`w-fit rounded-md border px-2 py-1 text-xs ${statusClass(memoryStatus)}`}>
              {statusLabel(memoryStatus)}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <MiniStat label="Provider" value={snapshot.memory.health.provider} />
            <MiniStat label="Fact docs" value={snapshot.memory.documentCount} />
            <MiniStat label="Last ingest" value={formatDate(snapshot.memory.lastIngest?.at)} />
            <MiniStat label="Failures 24h" value={snapshot.memory.failedOperations24h} />
          </div>

          <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="text-sm font-medium text-[var(--txt)]">Isolation</div>
            <p className="mt-1 text-xs text-[var(--txt3)]">{snapshot.memory.isolation.detail}</p>
            <p className="mt-2 text-xs text-[var(--txt3)]">Checked {formatDate(snapshot.memory.isolation.checkedAt)}</p>
          </div>

          {snapshot.memory.citations.length > 0 && (
            <div className="mt-4">
              <div className="text-sm font-medium text-[var(--txt)]">Recent citations</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {snapshot.memory.citations.map((citation) => (
                  <span key={citation} className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--txt3)]">
                    {citation}
                  </span>
                ))}
              </div>
            </div>
          )}

          {snapshot.canManageMembers && (
            <div className="mt-4 flex flex-wrap gap-3">
              <form action={runTenantMemoryBackfillAction}>
                <button className="rounded-md bg-[var(--teal)]/20 px-4 py-2 text-sm font-semibold text-[var(--teal)]">
                  Backfill memory
                </button>
              </form>
              <form action={runTenantMemoryMaintenanceAction}>
                <button className="rounded-md border border-[var(--border2)] px-4 py-2 text-sm font-semibold text-[var(--txt2)]">
                  Consolidate memory
                </button>
              </form>
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Memory Gaps" href="/settings">
            {memoryGaps.length === 0 ? (
              <EmptyLine>No provider gaps reported.</EmptyLine>
            ) : (
              memoryGaps.map((gap) => (
                <TimelineLine key={gap.id} title={`${gap.title} - ${gap.severity}`} detail={gap.detail} />
              ))
            )}
          </Panel>

          <Panel title="Stale Facts" href="/follow-up">
            {staleFacts.length === 0 ? (
              <EmptyLine>No stale facts detected.</EmptyLine>
            ) : (
              staleFacts.map((gap) => (
                <TimelineLine key={gap.id} title={`${gap.title} - ${gap.severity}`} detail={gap.detail} />
              ))
            )}
          </Panel>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-xl text-[var(--gold)]">Members</h2>
              <p className="mt-1 text-sm text-[var(--txt3)]">Brokerage access is invite-only by Google email.</p>
            </div>
            {snapshot.canManageMembers && <span className="text-xs text-[var(--txt3)]">Broker owner controls</span>}
          </div>
          <div className="mt-4 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
            {snapshot.members.map((member) => (
              <div key={member.id} className="flex flex-col gap-3 border-b border-[var(--border)] p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium text-[var(--txt)]">{member.name || member.email}</div>
                  <div className="mt-1 text-xs text-[var(--txt3)]">
                    {member.email} - {member.role} - {member.isActive ? "active" : "inactive"} - last login {formatDate(member.lastLoginAt)}
                  </div>
                </div>
                {snapshot.canManageMembers && member.role !== UserRole.ADMIN && member.id !== user.id && (
                  <form action={setTenantMemberActiveAction}>
                    <input type="hidden" name="userId" value={member.id} />
                    <input type="hidden" name="isActive" value={member.isActive ? "false" : "true"} />
                    <button className="rounded-md border border-[var(--border2)] px-3 py-1.5 text-xs text-[var(--txt2)]">
                      {member.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>

          {snapshot.canManageMembers && (
            <form action={createTenantMemberAction} className="mt-4 grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-[1fr_1fr_160px_auto]">
              <input name="email" type="email" placeholder="email@brokerage.com" className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm" />
              <input name="name" placeholder="Name" className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm" />
              <select name="role" defaultValue={UserRole.AGENT} className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm">
                <option value={UserRole.AGENT}>Agent</option>
                <option value={UserRole.BROKER_OWNER}>Broker owner</option>
              </select>
              <button className="rounded-md bg-[var(--teal)]/20 px-4 py-2 text-sm font-semibold text-[var(--teal)]">
                Add
              </button>
            </form>
          )}
        </div>

        <div className="space-y-6">
          <Panel title="Recent Agent Runs" href="/command">
            {snapshot.recentRuns.length === 0 ? (
              <EmptyLine>No runs yet.</EmptyLine>
            ) : (
              snapshot.recentRuns.map((run) => (
                <TimelineLine key={run.id} title={`${run.kind} - ${run.status}`} detail={`${run.trigger} - ${formatDate(run.startedAt)}`} />
              ))
            )}
          </Panel>

          <Panel title="Recent Jobs" href="/api/health?deep=1">
            {snapshot.recentJobs.length === 0 ? (
              <EmptyLine>No job runs yet.</EmptyLine>
            ) : (
              snapshot.recentJobs.map((job) => (
                <TimelineLine key={job.id} title={`${job.kind} - ${job.status}`} detail={job.error || job.summary || formatDate(job.startedAt)} />
              ))
            )}
          </Panel>

          <Panel title="Audit Trail" href="/command">
            {snapshot.recentAudit.length === 0 ? (
              <EmptyLine>No audit events yet.</EmptyLine>
            ) : (
              snapshot.recentAudit.map((event) => (
                <TimelineLine key={event.id} title={event.action} detail={`${event.subjectType ?? "workspace"} - ${formatDate(event.createdAt)}`} />
              ))
            )}
          </Panel>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, href }: { label: string; value: string | number; href?: string }) {
  const body = (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-[var(--txt)]">{value}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">{label}</div>
      <div className="mt-1 text-sm font-medium text-[var(--txt)]">{value}</div>
    </div>
  );
}

function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--bg)]">
      {children}
    </Link>
  );
}

function Panel({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg text-[var(--gold)]">{title}</h2>
        <Link href={href} className="text-xs text-[var(--teal)] hover:underline">
          Open
        </Link>
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function TimelineLine({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border-l-2 border-[var(--border2)] pl-3">
      <div className="text-sm font-medium text-[var(--txt)]">{title}</div>
      <div className="mt-0.5 text-xs text-[var(--txt3)]">{detail}</div>
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[var(--txt3)]">{children}</p>;
}

function errorText(error: string) {
  if (error === "member-email") return "Enter a member email.";
  if (error === "member-exists") return "A user with that email already exists.";
  if (error === "self-deactivate") return "You cannot deactivate yourself.";
  if (error === "member") return "Member could not be updated.";
  if (error === "memory-busy") return "Memory job is already running.";
  if (error === "memory") return "Memory operation failed.";
  return "Something went wrong.";
}
