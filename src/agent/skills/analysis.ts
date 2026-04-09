import { generateText, tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./types";
import { resolveLanguageModel } from "@/lib/ai-chat";
import { prisma } from "@/lib/prisma";

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
      description: "Generate a daily brief: what matters today across listings, calendar, and follow-ups.",
      parameters: z.object({}),
      execute: async () => {
        if (!ctx.tenantId) return { error: "No brokerage assigned." };
        const listings = await prisma.cachedListing.findMany({
          where: { tenantId: ctx.tenantId },
          select: { shortAddress: true, status: true, daysOnMarket: true, priceDisplay: true },
          orderBy: { daysOnMarket: "desc" },
          take: 10,
        });

        let calendarSummary = "Calendar not available (no Google token).";
        if (ctx.accessToken) {
          try {
            const { google } = await import("googleapis");
            const auth = new google.auth.OAuth2();
            auth.setCredentials({ access_token: ctx.accessToken });
            const cal = google.calendar({ version: "v3", auth });
            const now = new Date();
            const eod = new Date(now);
            eod.setHours(23, 59, 59, 999);
            const res = await cal.events.list({
              calendarId: "primary",
              timeMin: now.toISOString(),
              timeMax: eod.toISOString(),
              singleEvents: true,
              orderBy: "startTime",
            });
            const evts = res.data.items ?? [];
            calendarSummary = evts.length
              ? evts.map((e) => `${e.start?.dateTime ?? e.start?.date} — ${e.summary}`).join("\n")
              : "No events today.";
          } catch {
            calendarSummary = "Could not load calendar.";
          }
        }

        const model = resolveLanguageModel();
        if (!model) return { error: "No AI provider configured." };

        const listingBlock = listings
          .map((l) => `${l.shortAddress} | ${l.status} | ${l.daysOnMarket ?? "?"}d | ${l.priceDisplay}`)
          .join("\n");

        const result = await generateText({
          model,
          system: "You are a real estate executive assistant. Write a concise daily brief. Highlight what needs attention today.",
          prompt: `Today's date: ${new Date().toLocaleDateString()}\n\nCalendar:\n${calendarSummary}\n\nTop listings:\n${listingBlock}\n\nGenerate a brief.`,
        });

        return { brief: result.text };
      },
    }),
  };
}
