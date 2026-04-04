import { auth } from "@/auth";
import { Topbar } from "@/components/shell/topbar";
import { WorkflowNav } from "@/components/shell/workflow-nav";

export default async function MainAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <div className="relative z-10 min-h-screen">
      <Topbar session={session} />
      <WorkflowNav />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
