"use server";

import { prisma } from "@/lib/prisma";
import { checkBlueBubblesHealth } from "@/lib/channels";
import { encryptSecret } from "@/lib/crypto";
import { brandKitToJson, parseBrandKit } from "@/lib/marketing/brand-kit";
import { disconnectHubSpot, syncHubSpotForTenant } from "@/lib/hubspot";
import { disconnectBuffer, selectBufferProfiles } from "@/lib/buffer";
import { ensureOpsDefaults } from "@/lib/ops/defaults";
import { canEditBrokerageConfig } from "@/lib/ops/auth";
import { getMlsProvider } from "@/lib/mls/registry";
import { syncMlsProviderConfig } from "@/lib/mls/sync";
import { requireActiveUser, requireTenantUser } from "@/lib/session-guard";
import { uploadTenantLogo } from "@/lib/storage";
import { syncZillowProfileSource as runZillowSync } from "@/lib/zillow-sync";
import { ApprovalMode, ChannelKind, Prisma, SendingIdentityType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type TenantEditor = {
  userId: string;
  tenantId: string;
  canEdit: boolean;
};

async function getTenantEditorContext(): Promise<TenantEditor | null> {
  const user = await requireTenantUser();
  const role = user.role;
  if (role === "AGENT") return { userId: user.id, tenantId: user.tenantId, canEdit: false };
  if (role === "BROKER_OWNER" || role === "ADMIN") {
    return { userId: user.id, tenantId: user.tenantId, canEdit: true };
  }
  return null;
}

export async function updateTelegramId(formData: FormData) {
  const user = await requireActiveUser();

  const raw = String(formData.get("telegramId") ?? "").trim();
  const telegramId = raw.length > 0 ? raw : null;

  await prisma.user.update({
    where: { id: user.id },
    data: { telegramId },
  });
  revalidatePath("/settings");
}

export async function updateTenantProfile(formData: FormData) {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");

  const brokerageName = String(formData.get("brokerageName") ?? "").trim() || null;
  const defaultTone = String(formData.get("defaultTone") ?? "").trim();
  const brokerPhone = String(formData.get("brokerPhone") ?? "").trim() || null;
  const flyerNotifyEmail = String(formData.get("flyerNotifyEmail") ?? "").trim() || null;
  const existing = await prisma.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { brandKit: true },
  });
  const currentBrandKit = parseBrandKit(existing?.brandKit);
  const brandKit = {
    primaryColor:
      String(formData.get("brandPrimaryColor") ?? "").trim() ||
      currentBrandKit.primaryColor,
    secondaryColor:
      String(formData.get("brandSecondaryColor") ?? "").trim() ||
      currentBrandKit.secondaryColor,
    accentColor:
      String(formData.get("brandAccentColor") ?? "").trim() ||
      currentBrandKit.accentColor,
    fontStyle:
      String(formData.get("brandFontStyle") ?? "").trim() ||
      currentBrandKit.fontStyle,
    slogan:
      String(formData.get("brandSlogan") ?? "").trim() ||
      currentBrandKit.slogan,
    disclaimer:
      String(formData.get("brandDisclaimer") ?? "").trim() ||
      currentBrandKit.disclaimer,
  };

  await prisma.tenant.update({
    where: { id: ctx.tenantId },
    data: {
      brokerageName,
      defaultTone: defaultTone.length > 0 ? defaultTone : "Warm but professional. First-name basis. No pressure.",
      brokerPhone,
      flyerNotifyEmail,
      brandKit: brandKitToJson(brandKit),
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

  const source = await prisma.zillowProfileSource.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!source) redirect("/settings?error=zillow-id");

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

export async function syncHubSpotAction() {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");

  let summary: Awaited<ReturnType<typeof syncHubSpotForTenant>>;
  try {
    summary = await syncHubSpotForTenant({
      prisma,
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "HubSpot sync failed.";
    redirect(`/settings?error=hubspot-sync&detail=${encodeURIComponent(detail)}`);
  }

  revalidatePath("/settings");
  revalidatePath("/marketing");
  revalidatePath("/contacts");
  revalidatePath("/follow-up");
  redirect(
    `/settings?saved=hubspot-sync&contacts=${summary.contactsImported}&listings=${summary.listingsImported}`
  );
}

export async function disconnectHubSpotAction() {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");
  await disconnectHubSpot({ prisma, tenantId: ctx.tenantId });
  revalidatePath("/settings");
  redirect("/settings?saved=hubspot-disconnect");
}

export async function disconnectBufferAction() {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");
  await disconnectBuffer({ prisma, tenantId: ctx.tenantId });
  revalidatePath("/settings");
  redirect("/settings?saved=buffer-disconnect");
}

export async function addMlsProviderConfigAction(formData: FormData) {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");

  const providerKey = String(formData.get("providerKey") ?? "").trim();
  const provider = getMlsProvider(providerKey);
  if (!provider) redirect("/settings?error=mls-provider");

  const label = String(formData.get("label") ?? "").trim() || provider.label;
  const region = String(formData.get("region") ?? "").trim() || null;
  const baseUrl = String(formData.get("baseUrl") ?? "").trim();
  const query = String(formData.get("query") ?? "").trim();
  const manualListings = String(formData.get("manualListings") ?? "").trim();
  const secret = String(formData.get("secret") ?? "").trim();
  const enabled = formData.get("enabled") === "on";
  const config: Record<string, unknown> = {};

  if (baseUrl) config.baseUrl = baseUrl;
  if (query) config.query = query;
  if (manualListings) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(manualListings);
    } catch {
      redirect("/settings?error=mls-json");
    }
    if (!Array.isArray(parsed)) redirect("/settings?error=mls-json");
    config.listings = parsed;
  }

  await prisma.mlsProviderConfig.create({
    data: {
      tenantId: ctx.tenantId,
      providerKey,
      label,
      region,
      enabled,
      status: enabled ? "configured" : "disabled",
      config: JSON.parse(JSON.stringify(config)) as Prisma.InputJsonObject,
      secretRef: secret ? encryptSecret(secret) : null,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/marketing");
  redirect("/settings?saved=mls-add");
}

export async function setMlsProviderEnabledAction(formData: FormData) {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) redirect("/settings?error=mls-id");
  const enabled = formData.get("enabled") === "true";
  await prisma.mlsProviderConfig.updateMany({
    where: { id, tenantId: ctx.tenantId },
    data: { enabled, status: enabled ? "configured" : "disabled" },
  });

  revalidatePath("/settings");
  redirect("/settings?saved=mls-update");
}

export async function removeMlsProviderConfigAction(formData: FormData) {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) redirect("/settings?error=mls-id");

  await prisma.mlsProviderConfig.deleteMany({
    where: { id, tenantId: ctx.tenantId },
  });
  revalidatePath("/settings");
  revalidatePath("/marketing");
  redirect("/settings?saved=mls-remove");
}

export async function syncMlsProviderConfigAction(formData: FormData) {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) redirect("/settings?error=mls-id");

  let result: Awaited<ReturnType<typeof syncMlsProviderConfig>>;
  try {
    result = await syncMlsProviderConfig({
      prisma,
      configId: id,
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      force: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "MLS sync failed.";
    redirect(`/settings?error=mls-sync&detail=${encodeURIComponent(detail)}`);
  }

  revalidatePath("/settings");
  revalidatePath("/marketing");
  if (result.errors.length > 0) {
    redirect(
      `/settings?error=mls-sync&imported=${result.imported}&detail=${encodeURIComponent(result.errors[0])}`
    );
  }
  redirect(`/settings?saved=mls-sync&imported=${result.imported}`);
}

export async function selectBufferProfilesAction(formData: FormData) {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");
  const profileIds = formData.getAll("profileIds").map(String).filter(Boolean);
  await selectBufferProfiles({ prisma, tenantId: ctx.tenantId, profileIds });
  revalidatePath("/settings");
  redirect("/settings?saved=buffer-profiles");
}

export async function updateAutomationPolicyAction(formData: FormData) {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");

  const defaultApprovalMode = String(
    formData.get("defaultApprovalMode") ?? "AUTO_SEND_LOW_RISK"
  ) as ApprovalMode;

  await prisma.tenant.update({
    where: { id: ctx.tenantId },
    data: { defaultApprovalMode },
  });

  await ensureOpsDefaults(prisma, ctx.tenantId);
  revalidatePath("/settings");
  revalidatePath("/follow-up");
  revalidatePath("/command");
}

export async function addLeadSourceAction(formData: FormData) {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const { slugify } = await import("@/lib/slug");
  await prisma.leadSource.upsert({
    where: { tenantId_slug: { tenantId: ctx.tenantId, slug: slugify(name) } },
    create: { tenantId: ctx.tenantId, name, slug: slugify(name) },
    update: { name, isActive: true },
  });
  revalidatePath("/settings");
  revalidatePath("/contacts");
}

export async function addSendingIdentityAction(formData: FormData) {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");
  const channel = String(formData.get("channel") ?? "GMAIL") as ChannelKind;
  const type = String(formData.get("type") ?? "SHARED_OPS") as SendingIdentityType;
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!displayName) return;

  await prisma.sendingIdentity.create({
    data: {
      tenantId: ctx.tenantId,
      channel,
      type,
      displayName,
      email: String(formData.get("email") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      isDefault: formData.get("isDefault") === "on",
    },
  });
  revalidatePath("/settings");
}

export async function updateAgentLoopAction(formData: FormData) {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  await prisma.agentLoop.updateMany({
    where: { id, tenantId: ctx.tenantId },
    data: {
      enabled: formData.get("enabled") === "on",
      cadence: String(formData.get("cadence") ?? "manual").trim() || "manual",
      persona: String(formData.get("persona") ?? "").trim() || null,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/command");
}

export async function configureBlueBubblesAction(formData: FormData) {
  const ctx = await getTenantEditorContext();
  if (!ctx?.canEdit) throw new Error("Forbidden");
  const baseUrl = String(formData.get("baseUrl") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  if (!baseUrl) return;

  const existing = await prisma.channelAccount.findFirst({
    where: { tenantId: ctx.tenantId, kind: ChannelKind.BLUEBUBBLES },
    select: { id: true, secretRef: true },
  });
  const data = {
    label: String(formData.get("label") ?? "").trim() || "BlueBubbles Mac mini",
    status: "configured",
    config: { baseUrl },
    secretRef: password ? encryptSecret(password) : existing?.secretRef ?? null,
  };
  if (existing) {
    await prisma.channelAccount.update({ where: { id: existing.id }, data });
  } else {
    await prisma.channelAccount.create({
      data: {
        tenantId: ctx.tenantId,
        kind: ChannelKind.BLUEBUBBLES,
        ...data,
      },
    });
  }
  revalidatePath("/settings");
}

export async function checkBlueBubblesAction() {
  const user = await requireTenantUser();
  if (!canEditBrokerageConfig(user.role)) {
    throw new Error("Forbidden");
  }
  await checkBlueBubblesHealth(prisma, user.tenantId);
  revalidatePath("/settings");
}
