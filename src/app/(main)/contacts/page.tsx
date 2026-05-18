import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ensureOpsDefaults } from "@/lib/ops/defaults";
import { contactDisplayName } from "@/lib/ops/workflows";
import {
  createContactAction,
  logNoteAction,
  toggleVipAction,
} from "@/app/(main)/contacts/_actions";

export default async function ContactsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.tenantId) {
    return (
      <div>
        <h1 className="font-display text-3xl text-[var(--txt)]">Contacts</h1>
        <p className="mt-2 text-[var(--txt2)]">Assign your user to a brokerage first.</p>
      </div>
    );
  }

  await ensureOpsDefaults(prisma, user.tenantId);
  const [contacts, sources, users] = await Promise.all([
    prisma.contact.findMany({
      where: { tenantId: user.tenantId },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        leadSource: true,
        touchpoints: { orderBy: { occurredAt: "desc" }, take: 4 },
        followUpTasks: { orderBy: { createdAt: "desc" }, take: 3 },
      },
      orderBy: [{ isVip: "desc" }, { updatedAt: "desc" }],
      take: 100,
    }),
    prisma.leadSource.findMany({ where: { tenantId: user.tenantId, isActive: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { tenantId: user.tenantId, isActive: true }, orderBy: { email: "asc" } }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl text-[var(--txt)]">Contacts</h1>
        <p className="mt-2 max-w-3xl text-[var(--txt2)]">
          Brokerage-owned contact memory: owner, source, notes, touchpoints, and follow-up history in one timeline.
        </p>
      </div>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="font-display text-xl text-[var(--gold)]">Add contact</h2>
        <form action={createContactAction} className="mt-4 grid gap-4 md:grid-cols-2">
          <input name="firstName" placeholder="First name" className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
          <input name="lastName" placeholder="Last name" className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
          <input name="email" type="email" placeholder="Email" className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
          <input name="phone" placeholder="Phone / iMessage number" className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
          <select name="leadSourceId" className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
            <option value="">Lead source</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select name="ownerUserId" defaultValue={user.id} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
            ))}
          </select>
          <textarea name="notes" rows={3} placeholder="Initial notes" className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm md:col-span-2" />
          <div className="md:col-span-2">
            <button type="submit" className="rounded-md bg-[var(--gold)] px-5 py-2 text-sm font-semibold text-[var(--bg)]">
              Save contact
            </button>
          </div>
        </form>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        {contacts.length === 0 ? (
          <p className="text-sm text-[var(--txt3)]">No contacts yet.</p>
        ) : (
          contacts.map((contact) => (
            <article key={contact.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl text-[var(--gold)]">
                    {contactDisplayName(contact)}
                    {contact.isVip ? <span className="ml-2 text-xs text-[var(--amber)]">VIP</span> : null}
                  </h2>
                  <p className="mt-1 text-xs text-[var(--txt3)]">
                    {contact.email || "No email"} · {contact.phone || "No phone"}
                  </p>
                  <p className="mt-1 text-xs text-[var(--txt3)]">
                    Owner: {contact.owner?.name ?? contact.owner?.email ?? "Unassigned"} · Source:{" "}
                    {contact.leadSource?.name ?? "Unknown"}
                  </p>
                </div>
                <form action={toggleVipAction}>
                  <input type="hidden" name="contactId" value={contact.id} />
                  <button type="submit" className="rounded-md border border-[var(--border2)] px-3 py-1.5 text-xs text-[var(--txt2)]">
                    {contact.isVip ? "Remove VIP" : "Mark VIP"}
                  </button>
                </form>
              </div>

              {contact.notes && <p className="mt-3 text-sm text-[var(--txt2)]">{contact.notes}</p>}

              <form action={logNoteAction} className="mt-4 space-y-2">
                <input type="hidden" name="contactId" value={contact.id} />
                <input name="subject" placeholder="Note subject" className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs" />
                <textarea name="body" rows={2} placeholder="Log a note or call summary" className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
                <button type="submit" className="rounded-md bg-[var(--teal)]/20 px-3 py-1.5 text-xs font-semibold text-[var(--teal)]">
                  Log note
                </button>
              </form>

              <div className="mt-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--txt3)]">Recent timeline</h3>
                <div className="mt-2 space-y-2">
                  {contact.touchpoints.length === 0 ? (
                    <p className="text-xs text-[var(--txt3)]">No touchpoints yet.</p>
                  ) : (
                    contact.touchpoints.map((t) => (
                      <div key={t.id} className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div className="text-xs text-[var(--txt3)]">
                          {t.direction} {t.channel ? `· ${t.channel}` : ""} · {t.occurredAt.toLocaleString()}
                        </div>
                        <p className="mt-1 text-sm text-[var(--txt2)]">{t.subject ? `${t.subject}: ` : ""}{t.body}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
