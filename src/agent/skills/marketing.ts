import { generateText } from "ai";
import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./types";
import { resolveLanguageModel } from "@/lib/ai-chat";
import {
  marketingSystemPrompt,
  marketingUserPrompt,
  parseMarketingPackResponse,
  type ListingFacts,
} from "@/lib/marketing-generate";
import { prisma } from "@/lib/prisma";
import { getDriveClient } from "@/lib/drive";

export function marketingTools(ctx: ToolContext) {
  return {
    marketing_generate_pack: tool({
      description: "Generate a full marketing pack (MLS description, Instagram caption, email subjects, card line) for a listing.",
      parameters: z.object({
        listingId: z.string().optional().describe("CachedListing ID. If omitted, provide facts directly."),
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        beds: z.number().optional(),
        baths: z.number().optional(),
        sqft: z.number().optional(),
        price: z.string().optional(),
        features: z.string().optional(),
        heroPhotoName: z.string().optional().describe("Name of the hero photo file for context."),
      }),
      execute: async (params) => {
        let facts: ListingFacts;

        if (params.listingId) {
          const listing = await prisma.cachedListing.findUnique({
            where: { id: params.listingId },
          });
          if (!listing) return { error: "Listing not found." };
          facts = {
            address: listing.address,
            city: listing.city,
            state: listing.state,
            zip: listing.zip ?? "",
            beds: listing.beds,
            baths: listing.baths,
            sqft: listing.sqft,
            priceDisplay: listing.priceDisplay,
            features: listing.features ?? "",
            status: listing.status,
            daysOnMarket: listing.daysOnMarket,
          };
        } else {
          facts = {
            address: params.address ?? "Unknown",
            city: params.city ?? "",
            state: params.state ?? "",
            zip: "",
            beds: params.beds ?? null,
            baths: params.baths ?? null,
            sqft: params.sqft ?? null,
            priceDisplay: params.price ?? "—",
            features: params.features ?? "",
            status: "Active",
            daysOnMarket: null,
          };
        }

        const heroContext = params.heroPhotoName
          ? `Hero image: ${params.heroPhotoName}`
          : "No hero image selected.";

        const model = resolveLanguageModel();
        if (!model) return { error: "No AI provider configured." };

        const result = await generateText({
          model,
          system: marketingSystemPrompt(ctx.defaultTone),
          prompt: marketingUserPrompt(facts, heroContext),
        });

        const parsed = parseMarketingPackResponse(result.text);
        return { ...parsed, raw: result.text };
      },
    }),

    marketing_save_to_drive: tool({
      description: "Save generated marketing text as a Google Doc in a listing's Drive folder.",
      parameters: z.object({
        folderId: z.string().describe("Drive folder ID for the listing."),
        title: z.string().describe("Document title (e.g. 'MLS Description - 123 Main St')."),
        content: z.string().describe("Text content to write into the doc."),
      }),
      execute: async ({ folderId, title, content }) => {
        if (!ctx.accessToken) return { error: "No Drive token." };
        const drive = getDriveClient(ctx.accessToken);
        const res = await drive.files.create({
          requestBody: {
            name: title,
            mimeType: "application/vnd.google-apps.document",
            parents: [folderId],
          },
          supportsAllDrives: true,
        });
        const docId = res.data.id;
        if (docId && content) {
          const { google } = await import("googleapis");
          const auth = new google.auth.OAuth2();
          auth.setCredentials({ access_token: ctx.accessToken });
          const docs = google.docs({ version: "v1", auth });
          await docs.documents.batchUpdate({
            documentId: docId,
            requestBody: {
              requests: [{ insertText: { location: { index: 1 }, text: content } }],
            },
          });
        }
        return { saved: true, docId, title };
      },
    }),
  };
}
