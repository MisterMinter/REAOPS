import {
  canEditBrokerageConfig as canEditBrokerageConfigFromGuard,
  requireAdminUser,
  requireTenantUser,
} from "@/lib/session-guard";

export async function requireTenantActor() {
  const user = await requireTenantUser();
  return {
    id: user.id,
    tenantId: user.tenantId,
    role: user.role,
  };
}

export async function requireAdminActor() {
  const user = await requireAdminUser();
  return {
    id: user.id,
    tenantId: user.tenantId,
    role: user.role,
  };
}

export function canEditBrokerageConfig(role: string | null | undefined): boolean {
  return canEditBrokerageConfigFromGuard(role);
}
