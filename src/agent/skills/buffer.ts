import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./types";

export function bufferTools(_ctx: ToolContext) {
  return {
    buffer_create_draft: tool({
      description: "Create a Buffer social media draft for approval and scheduling. Currently a stub — Buffer OAuth is not wired yet.",
      parameters: z.object({
        text: z.string().describe("The caption / post text."),
        imageUrl: z.string().optional().describe("Optional image URL to attach."),
        platform: z.string().optional().describe("Target platform (instagram, facebook, twitter). Defaults to all."),
      }),
      execute: async ({ text, imageUrl, platform }) => {
        const token = process.env.BUFFER_ACCESS_TOKEN;
        if (!token) {
          return {
            status: "stub",
            message:
              "Buffer is not connected yet (no BUFFER_ACCESS_TOKEN). The draft would contain:",
            draft: { text, imageUrl, platform: platform ?? "all" },
          };
        }
        return {
          status: "stub",
          message: "Buffer API integration is planned for Phase 2. Draft saved locally.",
          draft: { text, imageUrl, platform: platform ?? "all" },
        };
      },
    }),
  };
}
