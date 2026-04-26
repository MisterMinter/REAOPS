import { generateText, tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./types";
import { resolveLanguageModel } from "@/lib/ai-chat";
import { prisma } from "@/lib/prisma";
import { buildDailyBrief } from "@/lib/daily-brief";
import { formatBriefPlainText } from "@/lib/daily-brief-format";

export function analysisTools(ctx: ToolContext) {
  return {
    portfolio_summary: tool({
      description: "Get a summary of the brokerage's listing portfolio: counts by status, high DOM, price ranges.",
      parameters: z.object({}),
      execute: async () => {
        if (!ctx.tenantId) return { error: "No brokerage assigned." };
        const listings = await prisma.cachedListing.findMany({
          where: { tenantId: ctx.tenantId },
          select: { status: true, priceDisplay: true, price: true, daysOnMarket: true, address: true, shortAddress: true },
        });
        const contacts = await prisma.cachedContact.count({ where: { tenantId: ctx.tenantId } });
        const byStatus: Record<string, number> = {};
        let highDom: { address: string; dom: number }[] = [];
        for (const l of listings) {
          byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
          if (l.daysOnMarket && l.daysOnMarket > 30) {
            highDom.push({ address: l.shortAddress || l.address, dom: l.daysOnMarket });
          }
        }
        highDom = highDom.sort((a, b) => b.dom - a.dom).slice(0, 10);
        return { totalListings: listings.length, totalContacts: contacts, byStatus, highDom };
      },
    }),

    suggest_actions: tool({
      description: "Analyze brokerage data and recommend priority actions (stale listings, follow-ups needed, etc.).",
      parameters: z.object({}),
      execute: async () => {
        if (!ctx.tenantId) return { error: "No brokerage assigned." };
        const listings = await prisma.cachedListing.findMany({
          where: { tenantId: ctx.tenantId },
          select: { shortAddress: true, status: true, daysOnMarket: true, price: true, priceDisplay: true },
        });

        const model = resolveLanguageModel();
        if (!model) return { error: "No AI provider configured." };

        const listingSummary = listings
          .map((l) => `${l.shortAddress} | ${l.status} | ${l.daysOnMarket ?? "?"}d | ${l.priceDisplay}`)
          .join("\n");

        const result = await generateText({
          model,
          system: "You are a real estate business analyst. Given listing data, suggest 3-5 concrete actions the broker should take today. Be specific with addresses and numbers.",
          prompt: `Here are the current listings:\n\n${listingSummary}\n\nWhat should the broker prioritize today?`,
        });

        return { suggestions: result.text };
      },
    }),

    report_daily_brief: tool({
      description:
        "Generate a comprehensive daily brief covering active listings, today's showings, " +
        "follow-up status, marketing queue, and AI recommendations.",
      parameters: z.object({}),
      execute: async () => {
        if (!ctx.tenantId) return { error: "No brokerage assigned." };

        try {
          const briefData = await buildDailyBrief(ctx.tenantId, ctx.accessToken);
          const text = formatBriefPlainText(briefData, "there");
          return { brief: text, structured: briefData };
        } catch (e) {
          console.error("[analysis] daily brief failed:", e);
          return { error: `Brief generation failed: ${e instanceof Error ? e.message : "unknown"}` };
        }
      },
    }),
  };
}
