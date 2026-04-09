import Link from "next/link";
import { auth } from "@/auth";
import { AssistantComposer } from "@/components/assistant/AssistantComposer";
import { getOnboardingSnapshot } from "@/lib/onboarding";
import { prisma } from "@/lib/prisma";

export default async function AssistantPage() {
  const session = await auth();
  const user = session?.user;
  const snap = user?.id
    ? await getOnboardingSnapshot(
        prisma,
        {
          id: user.id,
          role: user.role,
          tenantId: user.tenantId,
        },
        { googleTokenUserId: user.id }
      )
    : null;

  if (!user?.tenantId) {
    return (
      <div>
        <h1 className="font-display text-3xl text-[var(--txt)]">Broker Assistant</h1>
        <p className="mt-2 max-w-2xl text-[var(--txt2)]">
          Ask questions about your listings, contacts, and pipeline in plain language — powered by Claude with your
          HubSpot context.
        </p>
        <div className="mt-8 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/5 p-6">
          <p className="text-sm text-[var(--txt2)]">
            You need a brokerage assignment to use the assistant. See{" "}
            <Link href="/start" className="text-[var(--teal)] hover:underline">
              Start
            </Link>{" "}
            or contact your admin.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-3xl text-[var(--txt)]">Broker Assistant</h1>
      <p className="mt-2 max-w-2xl text-[var(--txt2)]">
        AI agent with tools for Google Drive, Calendar, property listings, marketing generation,
        follow-ups, and portfolio analysis. Ask anything — the agent will call the right tools
        automatically.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="text-xs text-[var(--txt3)]">Listings (cache)</div>
          <div className="mt-1 text-xl text-[var(--gold)]">{snap?.listingCount ?? 0}</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="text-xs text-[var(--txt3)]">Contacts (cache)</div>
          <div className="mt-1 text-xl text-[var(--gold)]">{snap?.contactCount ?? 0}</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="text-xs text-[var(--txt3)]">HubSpot</div>
          <div className="mt-1 text-sm text-[var(--txt)]">
            {snap?.hubspotConnected ? (
              <span className="text-[var(--green)]">Linked</span>
            ) : (
              <span className="text-[var(--txt3)]">Not linked</span>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="text-xs text-[var(--txt3)]">You</div>
          <div className="mt-1 text-sm text-[var(--txt2)]">{snap?.roleLabel}</div>
        </div>
      </div>

      <AssistantComposer />
    </div>
  );
}
