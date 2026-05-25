import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./types";
import {
  scrapeZillowProfile,
  scrapeZillowListingDetail,
} from "@/lib/zillow-scrape";
import { prisma } from "@/lib/prisma";
import { syncZillowProfileSource } from "@/lib/zillow-sync";

export function zillowTools(ctx: ToolContext) {
  return {
    zillow_scrape_profile: tool({
      description:
        "Fallback-only: scrape a Zillow agent/broker profile page when MLS/CRM/Drive do not have the listing yet. Gets active listings, sold listings, rentals, and contact info using Firecrawl v2 structured extraction; do not treat scraped facts as source of truth.",
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
        "Fallback-only: scrape a single Zillow listing page when official MLS/CRM/Drive facts are missing. Gets property details such as description, photos, features, schools, tax info, and walk score; caveat scraped facts before using them in publishable work.",
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
        "Fallback-only: sync a saved Zillow profile source into cached listings after MLS/CRM options have been checked. Scrapes the profile, batch-scrapes active listing details, and stores best-effort data with zillow: source IDs.",
      parameters: z.object({
        profileSourceId: z.string().describe("The ZillowProfileSource ID from Settings."),
      }),
      execute: async ({ profileSourceId }) => {
        if (!ctx.tenantId) return { error: "No brokerage assigned." };
        const source = await prisma.zillowProfileSource.findFirst({
          where: { id: profileSourceId, tenantId: ctx.tenantId },
          select: { id: true },
        });
        if (!source) return { error: "Zillow source not found." };
        return await syncZillowProfileSource(profileSourceId);
      },
    }),
  };
}
