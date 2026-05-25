import { NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export class AuthzError extends Error {
  constructor(
    message: string,
    readonly status = 401,
    readonly code = "unauthorized"
  ) {
    super(message);
    this.name = "AuthzError";
  }
}

export type ActiveSessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  tenantId: string | null;
  tenantName: string | null;
};

type GuardOptions = {
  tenant?: "optional" | "required" | "none";
  admin?: boolean;
  canEditBrokerage?: boolean;
};

export async function requireActiveUser(options: GuardOptions = {}): Promise<ActiveSessionUser> {
  const session = await auth();
  const sessionUserId = session?.user?.id;
  if (!sessionUserId) {
    throw new AuthzError("Unauthorized", 401, "unauthorized");
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUserId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      tenantId: true,
      isActive: true,
      tenant: {
        select: {
          name: true,
          brokerageName: true,
          isActive: true,
        },
      },
    },
  });

  if (!user || !user.isActive) {
    throw new AuthzError("Account is inactive.", 401, "inactive_user");
  }

  if (user.tenantId && !user.tenant?.isActive) {
    throw new AuthzError("Tenant is inactive.", 403, "inactive_tenant");
  }

  if (options.admin && user.role !== "ADMIN") {
    throw new AuthzError("Forbidden", 403, "admin_required");
  }

  if (options.canEditBrokerage && !canEditBrokerageConfig(user.role)) {
    throw new AuthzError("Forbidden", 403, "brokerage_edit_required");
  }

  if (options.tenant === "required" && !user.tenantId) {
    throw new AuthzError("Tenant required", 403, "tenant_required");
  }

  if (options.tenant === "none" && user.tenantId) {
    throw new AuthzError("Platform admin account required.", 403, "platform_admin_required");
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
    tenantName: user.tenant ? user.tenant.brokerageName ?? user.tenant.name : null,
  };
}

export async function requireTenantUser(): Promise<ActiveSessionUser & { tenantId: string }> {
  const user = await requireActiveUser({ tenant: "required" });
  return { ...user, tenantId: user.tenantId as string };
}

export async function requireAdminUser(): Promise<ActiveSessionUser> {
  return requireActiveUser({ admin: true });
}

export function canEditBrokerageConfig(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "BROKER_OWNER";
}

export function authzResponse(error: unknown) {
  if (error instanceof AuthzError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
