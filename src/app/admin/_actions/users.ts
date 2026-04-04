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
  const s = await auth();
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "").trim();
  const nextActive = String(formData.get("isActive") ?? "") === "true";
  if (!userId) redirect("/admin/users?error=user");
  if (userId === s?.user?.id && !nextActive) {
    redirect("/admin/users?error=self-deactivate");
  }
  await prisma.user.update({
    where: { id: userId },
    data: { isActive: nextActive },
  });
  revalidatePath("/admin/users");
  redirect("/admin/users");
}

export async function updateUser(formData: FormData) {
  await requireAdmin();
  const session = await auth();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!userId) redirect("/admin/users?error=user");

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || null;
  const roleRaw = String(formData.get("role") ?? "AGENT");
  const role = ROLES.includes(roleRaw as UserRole) ? (roleRaw as UserRole) : UserRole.AGENT;
  const tenantId = String(formData.get("tenantId") ?? "").trim() || null;

  if (!email) redirect(`/admin/users/${userId}?error=email`);

  if (role === UserRole.ADMIN && tenantId) {
    redirect(`/admin/users/${userId}?error=admin-tenant`);
  }
  if (role !== UserRole.ADMIN && !tenantId) {
    redirect(`/admin/users/${userId}?error=tenant`);
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) redirect("/admin/users?error=user");

  if (userId === session?.user?.id && role !== UserRole.ADMIN) {
    redirect(`/admin/users/${userId}?error=self-demote`);
  }

  if (target.role === UserRole.ADMIN && role !== UserRole.ADMIN) {
    const otherAdmins = await prisma.user.count({
      where: { role: UserRole.ADMIN, id: { not: userId } },
    });
    if (otherAdmins === 0) {
      redirect(`/admin/users/${userId}?error=last-admin`);
    }
  }

  const otherWithEmail = await prisma.user.findFirst({
    where: { email, id: { not: userId } },
  });
  if (otherWithEmail) {
    redirect(`/admin/users/${userId}?error=email-taken`);
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      email,
      name,
      role,
      tenantId: role === UserRole.ADMIN ? null : tenantId,
    },
  });
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  redirect(`/admin/users/${userId}?saved=1`);
}

export async function deleteUser(formData: FormData) {
  await requireAdmin();
  const session = await auth();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!userId) redirect("/admin/users?error=user");

  if (userId === session?.user?.id) {
    redirect("/admin/users?error=self-delete");
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) redirect("/admin/users?error=user");

  if (target.role === UserRole.ADMIN) {
    const adminCount = await prisma.user.count({ where: { role: UserRole.ADMIN } });
    if (adminCount <= 1) {
      redirect("/admin/users?error=last-admin-delete");
    }
  }

  await prisma.user.delete({ where: { id: userId } });
  revalidatePath("/admin/users");
  redirect("/admin/users?deleted=1");
}
