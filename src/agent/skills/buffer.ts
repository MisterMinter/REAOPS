import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./types";
import {
  createBufferDraft,
  listBufferProfiles,
} from "@/lib/buffer";
import { reviewContent, reviewToJson } from "@/lib/content-review";
import { createComplianceReview } from "@/lib/ops/workflows";

export function bufferTools(ctx: ToolContext) {
  return {
    buffer_list_profiles: tool({
      description:
        "List Buffer social media profiles connected to this account. Returns profile IDs, service names, and formatted usernames.",
      parameters: z.object({}),
      execute: async () => {
        if (!ctx.tenantId) return { error: "No brokerage assigned." };
        try {
          return { profiles: await listBufferProfiles({ tenantId: ctx.tenantId }) };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Buffer API error" };
        }
      },
    }),

    buffer_create_draft: tool({
      description:
        "Create a Buffer post draft (or schedule it). If no profileIds are provided, it will post to all connected profiles. Omit scheduledAt to add to the Buffer queue.",
      parameters: z.object({
        text: z.string().describe("The caption / post text."),
        profileIds: z
          .array(z.string())
          .optional()
          .describe("Buffer profile IDs to post to. If empty, posts to all profiles."),
        scheduledAt: z
          .string()
          .optional()
          .describe("ISO 8601 date-time to schedule the post. Omit to add to queue."),
        mediaUrl: z
          .string()
          .optional()
          .describe("Optional image URL to attach as media[photo]."),
      }),
      execute: async ({ text, profileIds, scheduledAt, mediaUrl }) => {
        if (!ctx.tenantId) return { error: "No brokerage assigned." };
        const review = await reviewContent({
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          kind: "SOCIAL_POST",
          title: scheduledAt ? "Scheduled Buffer post" : "Buffer draft",
          content: text,
        });
        if (review.status !== "PASS") {
          await createComplianceReview({
            actor: { id: ctx.userId, tenantId: ctx.tenantId },
            title: "Review gated Buffer post",
            summary: `Content review returned ${review.status}. ${review.reasons.join(" ")}`,
            flags: {
              source: "content_review",
              scheduledAt: scheduledAt ?? null,
              mediaUrl: mediaUrl ?? null,
              review: reviewToJson(review),
            },
          });
          return {
            success: false,
            blocked: review.status === "BLOCK",
            needsHuman: review.status === "NEEDS_HUMAN",
            review,
          };
        }

        try {
          const result = await createBufferDraft({
            tenantId: ctx.tenantId,
            text,
            profileIds,
            scheduledAt,
            mediaUrl,
          });
          return { success: true, result };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Buffer API error" };
        }
      },
    }),
  };
}
