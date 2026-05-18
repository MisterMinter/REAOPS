"use server";

import { ComplianceReviewStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireTenantActor } from "@/lib/ops/auth";
import { createComplianceReview } from "@/lib/ops/workflows";

function parseDate(raw: FormDataEntryValue | null): Date | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export async function createSopTemplateAction(formData: FormData) {
  const actor = await requireTenantActor();
  await prisma.sopTemplate.create({
    data: {
      tenantId: actor.tenantId,
      title: String(formData.get("title") ?? "").trim() || "Brokerage SOP",
      category: String(formData.get("category") ?? "").trim() || "contract",
      body: String(formData.get("body") ?? "").trim() || "Review against brokerage standard operating procedures.",
      checklist: String(formData.get("checklist") ?? "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    },
  });
  revalidatePath("/compliance");
}

export async function createComplianceReviewAction(formData: FormData) {
  const actor = await requireTenantActor();
  const rawFlags = String(formData.get("flags") ?? "").trim();
  await createComplianceReview({
    actor,
    title: String(formData.get("title") ?? "").trim() || "Compliance review",
    summary: String(formData.get("summary") ?? "").trim() || null,
    contactId: String(formData.get("contactId") ?? "").trim() || null,
    listingId: String(formData.get("listingId") ?? "").trim() || null,
    sopTemplateId: String(formData.get("sopTemplateId") ?? "").trim() || null,
    deadlineAt: parseDate(formData.get("deadlineAt")),
    flags: rawFlags ? rawFlags.split("\n").map((s) => s.trim()).filter(Boolean) : undefined,
  });
  revalidatePath("/compliance");
  revalidatePath("/command");
}

export async function updateComplianceStatusAction(formData: FormData) {
  const actor = await requireTenantActor();
  const reviewId = String(formData.get("reviewId") ?? "").trim();
  const status = String(formData.get("status") ?? "OPEN") as ComplianceReviewStatus;
  await prisma.complianceReview.updateMany({
    where: { id: reviewId, tenantId: actor.tenantId },
    data: {
      status,
      reviewedById: actor.id,
      reviewedAt: status === ComplianceReviewStatus.CLEARED ? new Date() : undefined,
    },
  });
  await prisma.auditEvent.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.id,
      action: "compliance.status",
      subjectType: "ComplianceReview",
      subjectId: reviewId,
      metadata: { status },
    },
  });
  revalidatePath("/compliance");
  revalidatePath("/command");
}
