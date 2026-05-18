import { auth } from "@/auth";

export async function requireTenantActor() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  if (!session.user.tenantId) throw new Error("Tenant required");
  return {
    id: session.user.id,
    tenantId: session.user.tenantId,
    role: session.user.role,
  };
}

export function canEditBrokerageConfig(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "BROKER_OWNER";
}
