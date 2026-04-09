import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./types";
import { fetchZillowProfileHtml, parseZillowListingHints } from "@/lib/zillow-scrape";
import { syncZillowProfileSource } from "@/lib/zillow-sync";

export function zillowTools(_ctx: ToolContext) {
  return {
    zillow_scrape_listing: tool({
      description: "Fetch a Zillow listing or profile page and extract listing links and zpids. Zillow often blocks datacenter IPs (403). Best effort.",
      parameters: z.object({
        url: z.string().url().describe("Full Zillow URL (profile or listing page)."),
      }),
      execute: async ({ url }) => {
        try {
          const html = await fetchZillowProfileHtml(url);
          const hints = parseZillowListingHints(html);
          return { found: hints.length, listings: hints.slice(0, 20) };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Zillow scrape failed." };
        }
      },
    }),

    zillow_sync_profile: tool({
      description: "Trigger a Zillow profile sync for a saved ZillowProfileSource ID. Imports listing links into the cache.",
      parameters: z.object({
        profileSourceId: z.string().describe("The ZillowProfileSource ID from Settings."),
      }),
      execute: async ({ profileSourceId }) => {
        const result = await syncZillowProfileSource(profileSourceId);
        return result;
      },
    }),
  };
}
