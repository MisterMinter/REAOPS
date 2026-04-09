import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./types";
import {
  scrapeZillowProfile,
  scrapeZillowListingDetail,
} from "@/lib/zillow-scrape";
import { syncZillowProfileSource } from "@/lib/zillow-sync";

export function zillowTools(_ctx: ToolContext) {
  return {
    zillow_scrape_profile: tool({
      description:
        "Scrape a Zillow agent/broker profile page to get their active listings, sold listings, rentals, and contact info. Uses Firecrawl v2 with structured JSON extraction.",
      parameters: z.object({
        url: z.string().url().describe("Zillow profile URL (e.g. https://www.zillow.com/profile/username)."),
      }),
      execute: async ({ url }) => {
        try {
          const profile = await scrapeZillowProfile(url);
          return {
            agentName: profile.agentName,
            brokerageName: profile.brokerageName,
            agentEmail: profile.agentEmail,
            agentPhone: profile.agentPhone,
            activeCount: profile.activeListings.length,
            soldCount: profile.soldListings.length,
            rentalCount: profile.rentals.length,
            activeListings: profile.activeListings.slice(0, 15),
            soldListings: profile.soldListings.slice(0, 10),
            rentals: profile.rentals.slice(0, 5),
          };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Profile scrape failed." };
        }
      },
    }),

    zillow_scrape_listing: tool({
      description:
        "Scrape a single Zillow listing page for full property details: description, photos, features, schools, tax info, walk score, etc. Uses Firecrawl v2 with split schema extraction (basic facts + features + neighborhood in parallel).",
      parameters: z.object({
        url: z.string().url().describe("Full Zillow listing URL (homedetails page)."),
      }),
      execute: async ({ url }) => {
        try {
          return await scrapeZillowListingDetail(url);
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Listing scrape failed." };
        }
      },
    }),

    zillow_sync_profile: tool({
      description:
        "Sync a saved Zillow profile source into cached listings. Scrapes the profile, batch-scrapes all active listing details concurrently, and stores everything in the database. Returns import count, detail count, errors, and duration.",
      parameters: z.object({
        profileSourceId: z.string().describe("The ZillowProfileSource ID from Settings."),
      }),
      execute: async ({ profileSourceId }) => {
        return await syncZillowProfileSource(profileSourceId);
      },
    }),
  };
}
