"use server";

import { ChannelKind, MessageRisk } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  approveDraft,
  createFollowUpTask,
  draftMessage,
  reviseDraft,
  sendApprovedMessage,
} from "@/lib/ops/workflows";
import { requireTenantActor } from "@/lib/ops/auth";

function parseDate(raw: FormDataEntryValue | null): Date | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export async function createFollowUpTaskAction(formData: FormData) {
  const actor = await requireTenantActor();
  await createFollowUpTask({
    actor,
    contactId: String(formData.get("contactId") ?? "").trim() || null,
    title: String(formData.get("title") ?? "").trim() || "Follow up",
    context: String(formData.get("context") ?? "").trim() || null,
    source: String(formData.get("source") ?? "").trim() || "manual",
    dueAt: parseDate(formData.get("dueAt")),
    risk: (String(formData.get("risk") ?? "LOW") as MessageRisk) || MessageRisk.LOW,
  });
  revalidatePath("/follow-up");
  revalidatePath("/command");
}

export async function draftMessageAction(formData: FormData) {
  const actor = await requireTenantActor();
  await draftMessage({
    actor,
    taskId: String(formData.get("taskId") ?? "").trim() || null,
    contactId: String(formData.get("contactId") ?? "").trim() || null,
    channel: (String(formData.get("channel") ?? "GMAIL") as ChannelKind) || ChannelKind.GMAIL,
    subject: String(formData.get("subject") ?? "").trim() || null,
    body: String(formData.get("body") ?? "").trim() || null,
    context: String(formData.get("context") ?? "").trim() || null,
    recipient: String(formData.get("recipient") ?? "").trim() || null,
    autoSend: formData.get("autoSend") === "on",
  });
  revalidatePath("/follow-up");
  revalidatePath("/command");
  revalidatePath("/contacts");
}

export async function approveDraftAction(formData: FormData) {
  const actor = await requireTenantActor();
  await approveDraft({
    actor,
    draftId: String(formData.get("draftId") ?? ""),
    approve: true,
  });
  revalidatePath("/follow-up");
  revalidatePath("/command");
}

export async function rejectDraftAction(formData: FormData) {
  const actor = await requireTenantActor();
  await approveDraft({
    actor,
    draftId: String(formData.get("draftId") ?? ""),
    approve: false,
    reason: String(formData.get("reason") ?? "").trim() || "Rejected in follow-up queue.",
  });
  revalidatePath("/follow-up");
  revalidatePath("/command");
}

export async function reviseDraftAction(formData: FormData) {
  const actor = await requireTenantActor();
  await reviseDraft({
    actor,
    draftId: String(formData.get("draftId") ?? ""),
    subject: String(formData.get("subject") ?? "").trim() || null,
    recipient: String(formData.get("recipient") ?? "").trim() || null,
    body: String(formData.get("body") ?? ""),
  });
  revalidatePath("/follow-up");
  revalidatePath("/command");
}

export async function sendDraftAction(formData: FormData) {
  const actor = await requireTenantActor();
  await sendApprovedMessage({
    actor,
    draftId: String(formData.get("draftId") ?? ""),
  });
  revalidatePath("/follow-up");
  revalidatePath("/command");
  revalidatePath("/contacts");
}
