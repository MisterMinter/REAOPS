"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";

const ROLES: UserRole[] = [UserRole.ADMIN, UserRole.BROKER_OWNER, UserRole.AGENT];

async function requireAdmin() {
  const s = await auth();
  if (s?.user?.role !== "ADMIN") throw new Error("Forbidden");
}

export async function createUser(formData: FormData) {
  await requireAdmin();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || null;
  const roleRaw = String(formData.get("role") ?? "AGENT");
  const role = ROLES.includes(roleRaw as UserRole) ? (roleRaw as UserRole) : UserRole.AGENT;
  const tenantId = String(formData.get("tenantId") ?? "").trim() || null;

  if (!email) redirect("/admin/users/new?error=email");

  if (role === "ADMIN" && tenantId) redirect("/admin/users/new?error=admin-tenant");
  if (role !== "ADMIN" && !tenantId) redirect("/admin/users/new?error=tenant");

  await prisma.user.create({
    data: {
      email,
      name,
      role,
      tenantId: role === "ADMIN" ? null : tenantId,
      isActive: true,
    },
  });
  revalidatePath("/admin/users");
  redirect("/admin/users");
}

export async function setUserActive(userId: string, isActive: boolean) {
  await requireAdmin();
  await prisma.user.update({
    where: { id: userId },
    data: { isActive },
  });
  revalidatePath("/admin/users");
}

export async function setUserActiveFromForm(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "").trim();
  const isActive = String(formData.get("isActive") ?? "") === "true";
  if (!userId) redirect("/admin/users?error=user");
  await prisma.user.update({
    where: { id: userId },
    data: { isActive },
  });
  revalidatePath("/admin/users");
  redirect("/admin/users");
}
