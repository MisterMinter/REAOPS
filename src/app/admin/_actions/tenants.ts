"use server";

import { auth } from "@/auth";
import { DEFAULT_DEAL_MAPPING, parseHubspotListingProps } from "@/lib/hubspot-mapping";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import { uploadTenantLogo } from "@/lib/storage";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function requireAdmin() {
  return auth().then((s) => {
    if (s?.user?.role !== "ADMIN") throw new Error("Forbidden");
    return s;
  });
}

export async function createTenant(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/admin/tenants/new?error=missing-name");

  let slug = String(formData.get("slug") ?? "").trim() || slugify(name);
  const brokerageName = String(formData.get("brokerageName") ?? "").trim() || null;

  const existing = await prisma.tenant.findUnique({ where: { slug } });
  if (existing) slug = `${slug}-${Date.now().toString(36)}`;

  await prisma.tenant.create({
    data: {
      name,
      slug,
      brokerageName,
      hubspotListingProps: DEFAULT_DEAL_MAPPING as object,
    },
  });
  revalidatePath("/admin/tenants");
  redirect("/admin/tenants");
}

export async function updateTenant(tenantId: string, formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect(`/admin/tenants/${tenantId}?error=missing-name`);

  const brokerageName = String(formData.get("brokerageName") ?? "").trim() || null;
  const defaultTone = String(formData.get("defaultTone") ?? "").trim();
  const hubspotListingObject = String(formData.get("hubspotListingObject") ?? "deals").trim() || "deals";
  const raw = String(formData.get("hubspotListingProps") ?? "");
  let props: object;
  try {
    props = parseHubspotListingProps(JSON.parse(raw || "{}"));
  } catch {
    redirect(`/admin/tenants/${tenantId}?error=invalid-json`);
  }

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      name,
      brokerageName,
      defaultTone: defaultTone || undefined,
      hubspotListingObject,
      hubspotListingProps: props,
    },
  });
  revalidatePath("/admin/tenants");
  revalidatePath(`/admin/tenants/${tenantId}`);
  redirect(`/admin/tenants/${tenantId}?saved=1`);
}

export async function uploadTenantLogoAction(tenantId: string, formData: FormData) {
  await requireAdmin();
  const file = formData.get("logo") as File | null;
  if (!file || file.size === 0) redirect(`/admin/tenants/${tenantId}?error=no-file`);

  const buf = Buffer.from(await file.arrayBuffer());
  const url = await uploadTenantLogo(tenantId, buf, file.type);

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { logoUrl: url },
  });
  revalidatePath(`/admin/tenants/${tenantId}`);
  redirect(`/admin/tenants/${tenantId}?saved=logo`);
}
