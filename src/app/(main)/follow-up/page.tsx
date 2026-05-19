import { ChannelKind, MessageDraftStatus, MessageRisk } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ensureOpsDefaults } from "@/lib/ops/defaults";
import { contactDisplayName } from "@/lib/ops/workflows";
import {
  approveDraftAction,
  createFollowUpTaskAction,
  draftMessageAction,
  rejectDraftAction,
  reviseDraftAction,
  sendDraftAction,
} from "@/app/(main)/follow-up/_actions";

function dateInputValue(d: Date) {
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

export default async function FollowUpPage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.tenantId) {
    return (
      <div>
        <h1 className="font-display text-3xl text-[var(--txt)]">Follow-Up Queue</h1>
        <p className="mt-2 text-[var(--txt2)]">Assign your user to a brokerage first.</p>
      </div>
    );
  }

  await ensureOpsDefaults(prisma, user.tenantId);
  const [contacts, tasks, drafts] = await Promise.all([
    prisma.contact.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ updatedAt: "desc" }],
      take: 100,
    }),
    prisma.followUpTask.findMany({
      where: { tenantId: user.tenantId },
      include: { contact: true, drafts: { orderBy: { createdAt: "desc" }, take: 3 } },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 50,
    }),
    prisma.messageDraft.findMany({
      where: { tenantId: user.tenantId },
      include: { contact: true, task: true, approvals: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl text-[var(--txt)]">Follow-Up Queue</h1>
        <p className="mt-2 max-w-3xl text-[var(--txt2)]">
          Create revenue-recovery tasks, draft follow-ups, approve sensitive messages, and send/log outreach from one
          durable queue.
        </p>
      </div>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="font-display text-xl text-[var(--gold)]">Create follow-up</h2>
        <form action={createFollowUpTaskAction} className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Contact</span>
            <select name="contactId" className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
              <option value="">No contact yet</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {contactDisplayName(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Due</span>
            <input
              name="dueAt"
              type="datetime-local"
              defaultValue={dateInputValue(tomorrow)}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </label>
          <label className="block md:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Title</span>
            <input
              name="title"
              required
              placeholder="Open house follow-up"
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </label>
          <label className="block md:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Context</span>
            <textarea
              name="context"
              rows={3}
              placeholder="Met at Sunday open house; interested in 3-bed homes near Decatur under $700k."
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Source</span>
            <input
              name="source"
              defaultValue="open_house"
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Risk</span>
            <select name="risk" defaultValue={MessageRisk.LOW} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
              {Object.values(MessageRisk).map((risk) => (
                <option key={risk} value={risk}>{risk}</option>
              ))}
            </select>
          </label>
          <div className="md:col-span-2">
            <button type="submit" className="rounded-md bg-[var(--gold)] px-5 py-2 text-sm font-semibold text-[var(--bg)]">
              Add to queue
            </button>
          </div>
        </form>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="font-display text-xl text-[var(--gold)]">Tasks</h2>
          <div className="mt-4 space-y-4">
            {tasks.length === 0 ? (
              <p className="text-sm text-[var(--txt3)]">No follow-up tasks yet.</p>
            ) : (
              tasks.map((task) => (
                <article key={task.id} className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-[var(--txt)]">{task.title}</h3>
                      <p className="mt-1 text-xs text-[var(--txt3)]">
                        {task.contact ? contactDisplayName(task.contact) : "No contact"} · {task.status} · {task.risk}
                      </p>
                    </div>
                    <span className="text-xs text-[var(--amber)]">
                      {task.dueAt ? task.dueAt.toLocaleString() : "No due date"}
                    </span>
                  </div>
                  {task.context && <p className="mt-3 text-sm text-[var(--txt2)]">{task.context}</p>}
                  <form action={draftMessageAction} className="mt-4 grid gap-3 md:grid-cols-2">
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="contactId" value={task.contactId ?? ""} />
                    <input type="hidden" name="context" value={task.context ?? task.title} />
                    <select name="channel" defaultValue={ChannelKind.GMAIL} className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm">
                      {Object.values(ChannelKind).map((channel) => (
                        <option key={channel} value={channel}>{channel}</option>
                      ))}
                    </select>
                    <input
                      name="recipient"
                      placeholder="Recipient override"
                      defaultValue={task.contact?.email ?? task.contact?.phone ?? ""}
                      className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                    />
                    <button type="submit" className="rounded-md border border-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--gold)] md:col-span-2">
                      Draft message
                    </button>
                  </form>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="font-display text-xl text-[var(--gold)]">Drafts & approvals</h2>
          <div className="mt-4 space-y-4">
            {drafts.length === 0 ? (
              <p className="text-sm text-[var(--txt3)]">No drafts yet.</p>
            ) : (
              drafts.map((draft) => (
                <article key={draft.id} className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-[var(--txt)]">{draft.subject ?? draft.task?.title ?? "Draft"}</h3>
                      <p className="mt-1 text-xs text-[var(--txt3)]">
                        {draft.contact ? contactDisplayName(draft.contact) : "No contact"} · {draft.channel} ·{" "}
                        {draft.status} · {draft.risk}
                      </p>
                    </div>
                    <span className={draft.requiresApproval ? "text-xs text-[var(--amber)]" : "text-xs text-[var(--green)]"}>
                      {draft.requiresApproval ? "Approval required" : "Auto-send eligible"}
                    </span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--txt2)]">{draft.body}</p>
                  {draft.status !== MessageDraftStatus.SENT &&
                    draft.status !== MessageDraftStatus.SKIPPED &&
                    draft.status !== MessageDraftStatus.FAILED && (
                      <form action={reviseDraftAction} className="mt-4 grid gap-3">
                        <input type="hidden" name="draftId" value={draft.id} />
                        <input
                          name="subject"
                          defaultValue={draft.subject ?? ""}
                          placeholder="Subject"
                          className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                        />
                        <input
                          name="recipient"
                          defaultValue={draft.recipient ?? ""}
                          placeholder="Recipient"
                          className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                        />
                        <textarea
                          name="body"
                          rows={5}
                          defaultValue={draft.body}
                          className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                        />
                        <button type="submit" className="w-fit rounded-md border border-[var(--teal)] px-3 py-1.5 text-xs font-semibold text-[var(--teal)]">
                          Save revision
                        </button>
                      </form>
                    )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {draft.status === MessageDraftStatus.WAITING_APPROVAL && (
                      <>
                        <form action={approveDraftAction}>
                          <input type="hidden" name="draftId" value={draft.id} />
                          <button type="submit" className="rounded-md bg-[var(--green)]/20 px-3 py-1.5 text-xs font-semibold text-[var(--green)]">
                            Approve
                          </button>
                        </form>
                        <form action={rejectDraftAction}>
                          <input type="hidden" name="draftId" value={draft.id} />
                          <button type="submit" className="rounded-md border border-[var(--coral)]/50 px-3 py-1.5 text-xs font-semibold text-[var(--coral)]">
                            Reject
                          </button>
                        </form>
                      </>
                    )}
                    {draft.status === MessageDraftStatus.APPROVED && (
                      <form action={sendDraftAction}>
                        <input type="hidden" name="draftId" value={draft.id} />
                        <button type="submit" className="rounded-md bg-[var(--gold)] px-3 py-1.5 text-xs font-semibold text-[var(--bg)]">
                          Send & log
                        </button>
                      </form>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
