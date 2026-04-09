import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./types";
import { prisma } from "@/lib/prisma";

export function listingTools(ctx: ToolContext) {
  return {
    listing_search: tool({
      description: "Search cached property listings by address, status, or keyword. Returns matching listings for this brokerage.",
      parameters: z.object({
        query: z.string().optional().describe("Address or keyword to search. Omit to list all."),
        status: z.string().optional().describe("Filter by status (e.g. 'Active', 'ZILLOW')."),
      }),
      execute: async ({ query, status }) => {
        if (!ctx.tenantId) return { error: "No brokerage assigned." };
        const where: Record<string, unknown> = { tenantId: ctx.tenantId };
        if (query) {
          where.OR = [
            { address: { contains: query, mode: "insensitive" } },
            { shortAddress: { contains: query, mode: "insensitive" } },
            { features: { contains: query, mode: "insensitive" } },
          ];
        }
        if (status) where.status = status;
        const listings = await prisma.cachedListing.findMany({
          where: where as never,
          take: 20,
          orderBy: { shortAddress: "asc" },
          select: {
            id: true,
            address: true,
            shortAddress: true,
            city: true,
            state: true,
            beds: true,
            baths: true,
            sqft: true,
            priceDisplay: true,
            status: true,
            daysOnMarket: true,
            driveFolderId: true,
          },
        });
        return { count: listings.length, listings };
      },
    }),

    listing_get_details: tool({
      description: "Get full details of a specific cached listing by its ID.",
      parameters: z.object({
        listingId: z.string().describe("The CachedListing ID."),
      }),
      execute: async ({ listingId }) => {
        const listing = await prisma.cachedListing.findUnique({
          where: { id: listingId },
        });
        if (!listing) return { error: "Listing not found." };
        if (listing.tenantId !== ctx.tenantId) return { error: "Listing belongs to another tenant." };
        return listing;
      },
    }),
  };
}
