import { generateText } from "ai";
import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./types";
import { resolveLanguageModel } from "@/lib/ai-chat";
import { reviewContent, reviewToJson } from "@/lib/content-review";
import {
  marketingSystemPrompt,
  marketingUserPrompt,
  parseMarketingPackResponse,
  type ListingFacts,
} from "@/lib/marketing-generate";
import { createListingLaunchPack } from "@/lib/marketing/launch-pack";
import { prisma } from "@/lib/prisma";
import { getDriveClient } from "@/lib/drive";
import { createComplianceReview, generateMarketingAsset } from "@/lib/ops/workflows";
import { MarketingAssetType } from "@prisma/client";

export function marketingTools(ctx: ToolContext) {
  return {
    marketing_create_launch_pack: tool({
      description:
        "Create a durable listing launch campaign with MLS copy, social posts, email blast, open house push, buyer follow-up script, seller update, and campaign timeline. Use this when the user asks to launch or fully market a listing.",
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
        goal: z
          .enum(["listing_launch", "open_house", "price_improvement", "stale_listing_recovery"])
          .optional(),
        heroPhotoName: z.string().optional(),
      }),
      execute: async (params) => {
        if (!ctx.tenantId) return { error: "No brokerage assigned." };
        const listingData = await resolveMarketingFacts(params, ctx.tenantId);
        if (!listingData.facts) return { error: "Listing not found." };

        const campaign = await createListingLaunchPack({
          actor: { id: ctx.userId, tenantId: ctx.tenantId },
          sourceListingKey: params.listingId ? `hs:${params.listingId}` : `manual:${listingData.facts.address}`,
          cachedListingId: params.listingId ?? null,
          driveFolderId: listingData.driveFolderId,
          facts: listingData.facts,
          goal: params.goal ?? "listing_launch",
          heroContext: params.heroPhotoName ? `Hero image: ${params.heroPhotoName}` : null,
        });

        return {
          campaignId: campaign.id,
          title: campaign.title,
          summary: campaign.summary,
          recommendedHero: campaign.recommendedHero,
          visibleIn: "/marketing",
          actionCount: campaign.items.length,
          items: campaign.items.map((item) => ({
            title: item.title,
            stage: item.stage,
            dueAt: item.dueAt,
            status: item.status,
          })),
        };
      },
    }),

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
        if (ctx.tenantId) {
          await generateMarketingAsset({
            actor: { id: ctx.userId, tenantId: ctx.tenantId },
            type: MarketingAssetType.MLS_COPY,
            title: `Marketing pack - ${facts.address}`,
            content: result.text,
            metadata: {
              listingId: params.listingId ?? null,
              address: facts.address,
              heroPhotoName: params.heroPhotoName ?? null,
            },
          }).catch((e) => console.error("[marketing-tool] asset persist failed:", e));
        }
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
        if (!ctx.tenantId) return { error: "No brokerage assigned." };
        const review = await reviewContent({
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          kind: "DRIVE_DOC",
          title,
          content,
        });
        if (review.status !== "PASS") {
          await createComplianceReview({
            actor: { id: ctx.userId, tenantId: ctx.tenantId },
            title: `Review gated Drive doc: ${title}`,
            summary: `Content review returned ${review.status}. ${review.reasons.join(" ")}`,
            flags: {
              source: "content_review",
              driveFolderId: folderId,
              review: reviewToJson(review),
            },
          });
          return {
            saved: false,
            blocked: review.status === "BLOCK",
            needsHuman: review.status === "NEEDS_HUMAN",
            review,
          };
        }
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

async function resolveMarketingFacts(
  params: {
    listingId?: string;
    address?: string;
    city?: string;
    state?: string;
    beds?: number;
    baths?: number;
    sqft?: number;
    price?: string;
    features?: string;
  },
  tenantId: string
): Promise<{ facts: ListingFacts | null; driveFolderId: string | null }> {
  if (params.listingId) {
    const listing = await prisma.cachedListing.findFirst({
      where: { id: params.listingId, tenantId },
    });
    if (!listing) return { facts: null, driveFolderId: null };
    return {
      facts: {
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
      },
      driveFolderId: listing.driveFolderId,
    };
  }

  return {
    facts: {
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
    },
    driveFolderId: null,
  };
}
