"use server";

import { AgentLoopKind } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { runAgentLoop } from "@/lib/agent-loops/runner";
import { requireTenantActor } from "@/lib/ops/auth";

export async function runAgentLoopAction(formData: FormData) {
  const actor = await requireTenantActor();
  const kind = String(formData.get("kind") ?? "DAILY_OPS") as AgentLoopKind;
  await runAgentLoop({
    tenantId: actor.tenantId,
    actorUserId: actor.id,
    kind,
    trigger: "manual_ui",
  });
  revalidatePath("/command");
  revalidatePath("/follow-up");
  revalidatePath("/marketing");
  revalidatePath("/compliance");
}
