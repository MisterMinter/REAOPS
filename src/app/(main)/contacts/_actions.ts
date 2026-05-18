"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireTenantActor } from "@/lib/ops/auth";
import { createContact, logTouchpoint } from "@/lib/ops/workflows";

export async function createContactAction(formData: FormData) {
  const actor = await requireTenantActor();
  await createContact({
    actor,
    firstName: String(formData.get("firstName") ?? "").trim() || null,
    lastName: String(formData.get("lastName") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    leadSourceId: String(formData.get("leadSourceId") ?? "").trim() || null,
    ownerUserId: String(formData.get("ownerUserId") ?? "").trim() || actor.id,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  revalidatePath("/contacts");
  revalidatePath("/command");
}

export async function logNoteAction(formData: FormData) {
  const actor = await requireTenantActor();
  await logTouchpoint({
    actor,
    contactId: String(formData.get("contactId") ?? "").trim() || null,
    body: String(formData.get("body") ?? "").trim() || "Manual note",
    subject: String(formData.get("subject") ?? "").trim() || "Manual note",
  });
  revalidatePath("/contacts");
  revalidatePath("/command");
}

export async function toggleVipAction(formData: FormData) {
  const actor = await requireTenantActor();
  const contactId = String(formData.get("contactId") ?? "").trim();
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId: actor.tenantId },
    select: { id: true, isVip: true },
  });
  if (!contact) throw new Error("Contact not found.");
  await prisma.contact.update({
    where: { id: contact.id },
    data: { isVip: !contact.isVip },
  });
  revalidatePath("/contacts");
  revalidatePath("/command");
}
