import type { UserRole } from "@prisma/client";

export type Permission =
  | "marketing.view"
  | "marketing.generate"
  | "marketing.publish"
  | "assistant.chat"
  | "settings.view"
  | "settings.edit"
  | "settings.integrations"
  | "admin.tenants"
  | "admin.users"
  | "admin.activity";

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  ADMIN: [
    "marketing.view",
    "marketing.generate",
    "marketing.publish",
    "assistant.chat",
    "settings.view",
    "settings.edit",
    "settings.integrations",
    "admin.tenants",
    "admin.users",
    "admin.activity",
  ],
  BROKER_OWNER: [
    "marketing.view",
    "marketing.generate",
    "marketing.publish",
    "assistant.chat",
    "settings.view",
    "settings.edit",
    "settings.integrations",
  ],
  AGENT: ["marketing.view", "marketing.generate", "assistant.chat", "settings.view"],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
