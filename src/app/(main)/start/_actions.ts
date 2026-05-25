"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireTenantUser } from "@/lib/session-guard";
import {
  backfillTenantBrain,
  maintainTenantBrain,
} from "@/lib/tenant-brain/ops";

const MEMBER_ROLES = [UserRole.BROKER_OWNER, UserRole.AGENT] as const;

async function requireMemberManager() {
  const user = await requireTenantUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.BROKER_OWNER) {
    throw new Error("Forbidden");
  }
  return user;
}

export async function createTenantMemberAction(formData: FormData) {
  const actor = await requireMemberManager();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || null;
  const roleRaw = String(formData.get("role") ?? UserRole.AGENT);
  const role = MEMBER_ROLES.includes(roleRaw as (typeof MEMBER_ROLES)[number])
    ? (roleRaw as UserRole)
    : UserRole.AGENT;

  if (!email) redirect("/start?error=member-email");

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) redirect("/start?error=member-exists");

  await prisma.user.create({
    data: {
      tenantId: actor.tenantId,
      email,
      name,
      role,
      isActive: true,
    },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.id,
      action: "member.create",
      subjectType: "User",
      metadata: { email, role },
    },
  });

  revalidatePath("/start");
  redirect("/start?saved=member");
}

export async function setTenantMemberActiveAction(formData: FormData) {
  const actor = await requireMemberManager();
  const userId = String(formData.get("userId") ?? "").trim();
  const isActive = String(formData.get("isActive") ?? "") === "true";
  if (!userId) redirect("/start?error=member");
  if (userId === actor.id && !isActive) redirect("/start?error=self-deactivate");

  const target = await prisma.user.findFirst({
    where: { id: userId, tenantId: actor.tenantId },
    select: { id: true, email: true, role: true },
  });
  if (!target || target.role === UserRole.ADMIN) redirect("/start?error=member");

  await prisma.user.update({
    where: { id: target.id },
    data: { isActive },
  });

  await prisma.auditEvent.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.id,
      action: isActive ? "member.activate" : "member.deactivate",
      subjectType: "User",
      subjectId: target.id,
      metadata: { email: target.email },
    },
  });

  revalidatePath("/start");
  redirect("/start?saved=member-status");
}

export async function runTenantMemoryBackfillAction() {
  const actor = await requireMemberManager();
  let destination = "/start?saved=memory-backfill";
  try {
    const job = await backfillTenantBrain({
      prisma,
      tenantId: actor.tenantId,
      userId: actor.id,
      trigger: "portal",
      reason: "portal_memory_backfill",
    });
    if (job.status === "skipped") destination = "/start?error=memory-busy";
  } catch {
    destination = "/start?error=memory";
  }

  revalidatePath("/start");
  redirect(destination);
}

export async function runTenantMemoryMaintenanceAction() {
  const actor = await requireMemberManager();
  let destination = "/start?saved=memory-maintenance";
  try {
    const job = await maintainTenantBrain({
      prisma,
      tenantId: actor.tenantId,
      userId: actor.id,
      trigger: "portal",
      reason: "portal_memory_maintenance",
    });
    if (job.status === "skipped") destination = "/start?error=memory-busy";
  } catch {
    destination = "/start?error=memory";
  }

  revalidatePath("/start");
  redirect(destination);
}
