import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./types";

const BUFFER_API = "https://api.bufferapp.com/1";

function getBufferToken(): string | null {
  return process.env.BUFFER_ACCESS_TOKEN ?? null;
}

async function bufferGet(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${BUFFER_API}${path}?access_token=${encodeURIComponent(token)}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Buffer API ${path} => ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function bufferPost(path: string, token: string, params: Record<string, string | string[]>): Promise<unknown> {
  const body = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (Array.isArray(val)) {
      for (const v of val) body.append(`${key}[]`, v);
    } else {
      body.append(key, val);
    }
  }
  body.append("access_token", token);

  const res = await fetch(`${BUFFER_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Buffer API POST ${path} => ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export function bufferTools(_ctx: ToolContext) {
  return {
    buffer_list_profiles: tool({
      description:
        "List Buffer social media profiles connected to this account. Returns profile IDs, service names, and formatted usernames.",
      parameters: z.object({}),
      execute: async () => {
        const token = getBufferToken();
        if (!token) {
          return { error: "Buffer is not configured. Set BUFFER_ACCESS_TOKEN on the server." };
        }
        try {
          const profiles = (await bufferGet("/profiles.json", token)) as Array<{
            id: string;
            service: string;
            formatted_username?: string;
            default?: boolean;
          }>;
          return {
            profiles: profiles.map((p) => ({
              id: p.id,
              service: p.service,
              username: p.formatted_username ?? "unknown",
              default: p.default ?? false,
            })),
          };
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
        const token = getBufferToken();
        if (!token) {
          return { error: "Buffer is not configured. Set BUFFER_ACCESS_TOKEN on the server." };
        }

        try {
          let ids = profileIds ?? [];
          if (ids.length === 0) {
            const profiles = (await bufferGet("/profiles.json", token)) as Array<{ id: string }>;
            ids = profiles.map((p) => p.id);
          }
          if (ids.length === 0) {
            return { error: "No Buffer profiles found. Connect at least one social account in Buffer." };
          }

          const params: Record<string, string | string[]> = {
            text,
            profile_ids: ids,
            draft: "true",
          };
          if (scheduledAt) params.scheduled_at = scheduledAt;
          if (mediaUrl) params["media[photo]"] = mediaUrl;

          const result = await bufferPost("/updates/create.json", token, params);
          return { success: true, result };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Buffer API error" };
        }
      },
    }),
  };
}
