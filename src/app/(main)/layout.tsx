import { auth } from "@/auth";
import { Topbar } from "@/components/shell/topbar";
import { WorkflowNav } from "@/components/shell/workflow-nav";
import { prisma } from "@/lib/prisma";

export default async function MainAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  let tenantPreview = null;
  if (session?.user?.tenantId) {
    const t = await prisma.tenant.findUnique({
      where: { id: session.user.tenantId },
      select: { brokerageName: true, name: true, logoUrl: true },
    });
    if (t) {
      tenantPreview = {
        displayName: t.brokerageName ?? t.name,
        logoUrl: t.logoUrl,
      };
    }
  }

  return (
    <div className="relative z-10 min-h-screen">
      <Topbar session={session} tenant={tenantPreview} />
      <WorkflowNav />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
