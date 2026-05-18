import { ComplianceReviewStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ensureOpsDefaults } from "@/lib/ops/defaults";
import { contactDisplayName } from "@/lib/ops/workflows";
import {
  createComplianceReviewAction,
  createSopTemplateAction,
  updateComplianceStatusAction,
} from "@/app/(main)/compliance/_actions";

export default async function CompliancePage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.tenantId) {
    return (
      <div>
        <h1 className="font-display text-3xl text-[var(--txt)]">Compliance</h1>
        <p className="mt-2 text-[var(--txt2)]">Assign your user to a brokerage first.</p>
      </div>
    );
  }

  await ensureOpsDefaults(prisma, user.tenantId);
  const [reviews, sops, contacts, listings] = await Promise.all([
    prisma.complianceReview.findMany({
      where: { tenantId: user.tenantId },
      include: { contact: true, listing: true, sopTemplate: true },
      orderBy: [{ status: "asc" }, { deadlineAt: "asc" }, { createdAt: "desc" }],
      take: 50,
    }),
    prisma.sopTemplate.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: "desc" } }),
    prisma.contact.findMany({ where: { tenantId: user.tenantId }, orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.listing.findMany({ where: { tenantId: user.tenantId }, orderBy: { shortAddress: "asc" }, take: 100 }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl text-[var(--txt)]">Compliance</h1>
        <p className="mt-2 max-w-3xl text-[var(--txt2)]">
          Contract completeness, brokerage SOP checks, deadline tracking, and fair-housing copy review. This is an
          operational workflow, not legal advice.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="font-display text-xl text-[var(--gold)]">Create review</h2>
          <form action={createComplianceReviewAction} className="mt-4 grid gap-4 md:grid-cols-2">
            <input name="title" required placeholder="Purchase agreement completeness check" className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm md:col-span-2" />
            <select name="sopTemplateId" className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
              <option value="">SOP template</option>
              {sops.map((sop) => (
                <option key={sop.id} value={sop.id}>{sop.title}</option>
              ))}
            </select>
            <input name="deadlineAt" type="datetime-local" className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
            <select name="contactId" className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
              <option value="">Related contact</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{contactDisplayName(c)}</option>
              ))}
            </select>
            <select name="listingId" className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
              <option value="">Related listing</option>
              {listings.map((l) => (
                <option key={l.id} value={l.id}>{l.shortAddress || l.address}</option>
              ))}
            </select>
            <textarea name="summary" rows={3} placeholder="What needs to be reviewed?" className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm md:col-span-2" />
            <textarea name="flags" rows={3} placeholder="Optional flags, one per line" className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm md:col-span-2" />
            <div className="md:col-span-2">
              <button type="submit" className="rounded-md bg-[var(--gold)] px-5 py-2 text-sm font-semibold text-[var(--bg)]">
                Add review
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="font-display text-xl text-[var(--gold)]">Add SOP template</h2>
          <form action={createSopTemplateAction} className="mt-4 space-y-4">
            <input name="title" required placeholder="Brokerage contract SOP" className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
            <input name="category" defaultValue="contract" className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
            <textarea name="body" rows={4} placeholder="SOP narrative" className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
            <textarea name="checklist" rows={4} placeholder="Checklist items, one per line" className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
            <button type="submit" className="rounded-md border border-[var(--gold)] px-5 py-2 text-sm font-semibold text-[var(--gold)]">
              Save SOP
            </button>
          </form>
        </section>
      </div>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="font-display text-xl text-[var(--gold)]">Review queue</h2>
        <div className="mt-4 space-y-4">
          {reviews.length === 0 ? (
            <p className="text-sm text-[var(--txt3)]">No compliance reviews yet.</p>
          ) : (
            reviews.map((review) => (
              <article key={review.id} className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-medium text-[var(--txt)]">{review.title}</h3>
                    <p className="mt-1 text-xs text-[var(--txt3)]">
                      {review.status} · {review.sopTemplate?.title ?? "No SOP"} ·{" "}
                      {review.deadlineAt ? `deadline ${review.deadlineAt.toLocaleString()}` : "no deadline"}
                    </p>
                    <p className="mt-1 text-xs text-[var(--txt3)]">
                      {review.contact ? contactDisplayName(review.contact) : "No contact"} ·{" "}
                      {review.listing?.shortAddress ?? review.listing?.address ?? "No listing"}
                    </p>
                  </div>
                  <form action={updateComplianceStatusAction} className="flex flex-wrap gap-2">
                    <input type="hidden" name="reviewId" value={review.id} />
                    <select name="status" defaultValue={review.status} className="rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs">
                      {Object.values(ComplianceReviewStatus).map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                    <button type="submit" className="rounded-md bg-[var(--teal)]/20 px-3 py-1 text-xs font-semibold text-[var(--teal)]">
                      Update
                    </button>
                  </form>
                </div>
                {review.summary && <p className="mt-3 text-sm text-[var(--txt2)]">{review.summary}</p>}
                {Array.isArray(review.flags) && review.flags.length > 0 && (
                  <ul className="mt-3 list-inside list-disc text-sm text-[var(--amber)]">
                    {review.flags.map((flag, idx) => (
                      <li key={idx}>{String(flag)}</li>
                    ))}
                  </ul>
                )}
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
