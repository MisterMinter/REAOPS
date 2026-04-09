"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { uploadTenantLogo } from "@/lib/storage";
import { syncZillowProfileSource as runZillowSync } from "@/lib/zillow-sync";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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
  if (!file || file.size === 0) redirect("/settings?error=logo-no-file");

  const buf = Buffer.from(await file.arrayBuffer());
  let url: string;
  try {
    url = await uploadTenantLogo(ctx.tenantId, buf, file.type);
  } catch {
    redirect("/settings?error=logo-invalid");
  }

  await prisma.tenant.update({
    where: { id: ctx.tenantId },
    data: { logoUrl: url },
  });
  revalidatePath("/settings");
  revalidatePath("/marketing");
  revalidatePath("/assistant");
  redirect("/settings?saved=logo");
}

export async function addZillowProfileSource(formData: FormData) {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");

  const profileUrl = String(formData.get("profileUrl") ?? "").trim();
  const displayLabel = String(formData.get("displayLabel") ?? "").trim() || null;
  const assignRaw = String(formData.get("assignedUserId") ?? "").trim();
  let assignedUserId: string | null = assignRaw.length > 0 ? assignRaw : null;

  if (!profileUrl) redirect("/settings?error=zillow-url");

  if (assignedUserId) {
    const u = await prisma.user.findFirst({
      where: { id: assignedUserId, tenantId: ctx.tenantId },
    });
    if (!u) assignedUserId = null;
  }

  await prisma.zillowProfileSource.create({
    data: {
      tenantId: ctx.tenantId,
      profileUrl,
      displayLabel,
      assignedUserId,
    },
  });
  revalidatePath("/settings");
  revalidatePath("/marketing");
  redirect("/settings?saved=zillow-add");
}

export async function removeZillowProfileSource(formData: FormData) {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) redirect("/settings?error=zillow-id");

  await prisma.zillowProfileSource.deleteMany({
    where: { id, tenantId: ctx.tenantId },
  });
  revalidatePath("/settings");
  revalidatePath("/marketing");
  redirect("/settings?saved=zillow-remove");
}

export async function syncZillowProfileSourceAction(formData: FormData) {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) redirect("/settings?error=zillow-id");

  const result = await runZillowSync(id);
  revalidatePath("/settings");
  revalidatePath("/marketing");

  if (result.errors.length > 0) {
    redirect(
      `/settings?error=zillow-sync&imported=${result.imported}&detail=${encodeURIComponent(result.errors[0])}`
    );
  }
  redirect(`/settings?saved=zillow-sync&imported=${result.imported}`);
}
