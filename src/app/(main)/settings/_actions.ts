"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { uploadTenantLogo } from "@/lib/storage";
import { revalidatePath } from "next/cache";

type TenantEditor = {
  userId: string;
  tenantId: string;
  canEdit: boolean;
};

async function getTenantEditorContext(): Promise<TenantEditor | null> {
  const s = await auth();
  if (!s?.user?.id || !s.user.tenantId) return null;
  const role = s.user.role;
  if (role === "AGENT") return { userId: s.user.id, tenantId: s.user.tenantId, canEdit: false };
  if (role === "BROKER_OWNER" || role === "ADMIN") {
    return { userId: s.user.id, tenantId: s.user.tenantId, canEdit: true };
  }
  return null;
}

export async function updateTenantProfile(formData: FormData) {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");

  const brokerageName = String(formData.get("brokerageName") ?? "").trim() || null;
  const defaultTone = String(formData.get("defaultTone") ?? "").trim();

  await prisma.tenant.update({
    where: { id: ctx.tenantId },
    data: {
      brokerageName,
      defaultTone: defaultTone.length > 0 ? defaultTone : "Warm but professional. First-name basis. No pressure.",
    },
  });
  revalidatePath("/settings");
}

export async function updateDriveRootFolder(formData: FormData) {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");

  const raw = String(formData.get("rootFolderId") ?? "").trim();
  if (!raw) {
    await prisma.driveConfig.deleteMany({ where: { tenantId: ctx.tenantId } });
    revalidatePath("/settings");
    return;
  }

  await prisma.driveConfig.upsert({
    where: { tenantId: ctx.tenantId },
    create: { tenantId: ctx.tenantId, rootFolderId: raw },
    update: { rootFolderId: raw },
  });
  revalidatePath("/settings");
}

export async function uploadTenantLogoFromSettings(formData: FormData) {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");

  const file = formData.get("logo") as File | null;
  if (!file || file.size === 0) throw new Error("No file");

  const buf = Buffer.from(await file.arrayBuffer());
  const url = await uploadTenantLogo(ctx.tenantId, buf, file.type);

  await prisma.tenant.update({
    where: { id: ctx.tenantId },
    data: { logoUrl: url },
  });
  revalidatePath("/settings");
  revalidatePath("/marketing");
  revalidatePath("/assistant");
}
