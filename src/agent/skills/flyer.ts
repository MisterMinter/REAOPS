import { generateObject, tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./types";
import { resolveLanguageModel } from "@/lib/ai-chat";
import { prisma } from "@/lib/prisma";
import { getDriveClient, listPhotosInFolder } from "@/lib/drive";
import { renderFlyerHtml, type FlyerData } from "@/lib/flyer-templates";
import { renderFlyerPdf, renderFlyerPng } from "@/lib/flyer-render";
import { sendEmail } from "@/lib/gmail-send";
import { Readable } from "stream";

const flyerCopySchema = z.object({
  templateStyle: z.enum(["modern", "luxury", "bold"]),
  accentColor: z.string().describe("Hex color that fits the property vibe, e.g. #1a3a5c"),
  headline: z.string().describe("Punchy headline, max 60 chars"),
  tagline: z.string().describe("Supporting tagline, max 120 chars"),
  featureBullets: z.array(z.string()).max(4).describe("Up to 4 short feature highlights"),
  ctaText: z.string().describe("Call-to-action text, max 80 chars"),
});

export function flyerTools(ctx: ToolContext) {
  return {
    flyer_create: tool({
      description:
        "Create a print-ready PDF flyer and social-media PNG for a property listing. " +
        "The AI picks a template style and generates copy, then the flyer is rendered with " +
        "the hero photo and uploaded to the listing's Drive folder.",
      parameters: z.object({
        listingId: z.string().optional().describe("CachedListing ID. If omitted, provide facts directly."),
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zip: z.string().optional(),
        beds: z.number().optional(),
        baths: z.number().optional(),
        sqft: z.number().optional(),
        price: z.string().optional(),
        features: z.string().optional(),
        templateStyle: z.enum(["modern", "luxury", "bold"]).optional().describe("Override AI template choice."),
      }),
      execute: async (params) => {
        const model = resolveLanguageModel();
        if (!model) return { error: "No AI provider configured." };

        const { facts, driveFolderId } = await resolveListing(params);
        if (!facts) return { error: "Listing not found." };

        const heroImage = await fetchHeroPhoto(ctx.accessToken, driveFolderId);

        const broker = await resolveBroker(ctx.tenantId);

        const aiCopy = await generateObject({
          model,
          schema: flyerCopySchema,
          prompt: buildFlyerPrompt(facts, broker),
        });
        const copy = aiCopy.object;
        if (params.templateStyle) copy.templateStyle = params.templateStyle;

        const flyerData: FlyerData = {
          ...copy,
          heroImageBase64: heroImage?.base64 ?? null,
          heroImageMimeType: heroImage?.mimeType ?? "image/jpeg",
          address: facts.address,
          city: facts.city,
          state: facts.state,
          zip: facts.zip,
          beds: facts.beds,
          baths: facts.baths,
          sqft: facts.sqft,
          priceDisplay: facts.priceDisplay,
          brokerName: broker.name,
          brokerLogo: broker.logo,
          brokerPhone: broker.phone,
          brokerEmail: broker.email,
        };

        const html = renderFlyerHtml(flyerData);

        let pdfBuffer: Buffer;
        let pngBuffer: Buffer;
        try {
          [pdfBuffer, pngBuffer] = await Promise.all([
            renderFlyerPdf(html),
            renderFlyerPng(html),
          ]);
        } catch (e) {
          console.error("[flyer] Render failed:", e);
          return { error: `Flyer rendering failed: ${e instanceof Error ? e.message : "unknown"}` };
        }

        const shortAddr = facts.address.replace(/,.*$/, "").trim();
        const pdfName = `Flyer - ${shortAddr}.pdf`;
        const pngName = `Flyer - ${shortAddr}.png`;

        let pdfDriveId: string | null = null;
        let pngDriveId: string | null = null;

        if (ctx.accessToken && driveFolderId) {
          try {
            [pdfDriveId, pngDriveId] = await Promise.all([
              uploadToDrive(ctx.accessToken, driveFolderId, pdfName, "application/pdf", pdfBuffer),
              uploadToDrive(ctx.accessToken, driveFolderId, pngName, "image/png", pngBuffer),
            ]);
          } catch (e) {
            console.error("[flyer] Drive upload failed:", e);
          }
        }

        return {
          success: true,
          templateStyle: copy.templateStyle,
          headline: copy.headline,
          pdfName,
          pngName,
          pdfDriveId,
          pngDriveId,
          pdfDriveUrl: pdfDriveId ? `https://drive.google.com/file/d/${pdfDriveId}/view` : null,
          pngDriveUrl: pngDriveId ? `https://drive.google.com/file/d/${pngDriveId}/view` : null,
          savedToDrive: !!(pdfDriveId || pngDriveId),
        };
      },
    }),

    flyer_email: tool({
      description:
        "Email a property flyer PDF to a recipient. Creates the flyer if needed, " +
        "then sends it as a Gmail attachment from the broker's account.",
      parameters: z.object({
        listingId: z.string().describe("CachedListing ID for the property."),
        recipientEmail: z.string().describe("Email address to send the flyer to."),
        templateStyle: z.enum(["modern", "luxury", "bold"]).optional(),
      }),
      execute: async ({ listingId, recipientEmail, templateStyle }) => {
        if (!ctx.accessToken) return { error: "No Google token — cannot send email." };

        const model = resolveLanguageModel();
        if (!model) return { error: "No AI provider configured." };

        const { facts, driveFolderId } = await resolveListing({ listingId });
        if (!facts) return { error: "Listing not found." };

        const heroImage = await fetchHeroPhoto(ctx.accessToken, driveFolderId);
        const broker = await resolveBroker(ctx.tenantId);

        const aiCopy = await generateObject({
          model,
          schema: flyerCopySchema,
          prompt: buildFlyerPrompt(facts, broker),
        });
        const copy = aiCopy.object;
        if (templateStyle) copy.templateStyle = templateStyle;

        const flyerData: FlyerData = {
          ...copy,
          heroImageBase64: heroImage?.base64 ?? null,
          heroImageMimeType: heroImage?.mimeType ?? "image/jpeg",
          address: facts.address,
          city: facts.city,
          state: facts.state,
          zip: facts.zip,
          beds: facts.beds,
          baths: facts.baths,
          sqft: facts.sqft,
          priceDisplay: facts.priceDisplay,
          brokerName: broker.name,
          brokerLogo: broker.logo,
          brokerPhone: broker.phone,
          brokerEmail: broker.email,
        };

        const html = renderFlyerHtml(flyerData);
        const pdfBuffer = await renderFlyerPdf(html);
        const shortAddr = facts.address.replace(/,.*$/, "").trim();
        const pdfFilename = `Flyer - ${shortAddr}.pdf`;

        try {
          const result = await sendEmail({
            accessToken: ctx.accessToken,
            to: recipientEmail,
            subject: `Property Flyer: ${shortAddr}`,
            bodyHtml: `<p>Hi,</p><p>Please find attached the property flyer for <strong>${shortAddr}</strong>.</p><p>Best regards,<br/>${broker.name}</p>`,
            pdfBuffer,
            pdfFilename,
          });
          return { success: true, messageId: result.messageId, sentTo: recipientEmail };
        } catch (e) {
          console.error("[flyer] Email send failed:", e);
          return { error: `Failed to send email: ${e instanceof Error ? e.message : "unknown"}` };
        }
      },
    }),
  };
}

type ListingFacts = {
  address: string;
  city: string;
  state: string;
  zip: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  priceDisplay: string;
  features: string;
};

async function resolveListing(params: {
  listingId?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  price?: string;
  features?: string;
}): Promise<{ facts: ListingFacts | null; driveFolderId: string | null }> {
  if (params.listingId) {
    const listing = await prisma.cachedListing.findUnique({
      where: { id: params.listingId },
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
      },
      driveFolderId: listing.driveFolderId,
    };
  }

  return {
    facts: {
      address: params.address ?? "Property",
      city: params.city ?? "",
      state: params.state ?? "",
      zip: params.zip ?? "",
      beds: params.beds ?? null,
      baths: params.baths ?? null,
      sqft: params.sqft ?? null,
      priceDisplay: params.price ?? "",
      features: params.features ?? "",
    },
    driveFolderId: null,
  };
}

type BrokerInfo = { name: string; logo: string | null; phone: string; email: string };

async function resolveBroker(tenantId: string | null): Promise<BrokerInfo> {
  if (!tenantId) return { name: "Brokerage", logo: null, phone: "", email: "" };

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { brokerageName: true, name: true, logoUrl: true },
  });

  const users = await prisma.user.findMany({
    where: { tenantId, role: { in: ["BROKER_OWNER", "ADMIN"] } },
    select: { email: true, name: true },
    take: 1,
  });

  const owner = users[0];
  return {
    name: tenant?.brokerageName ?? tenant?.name ?? "Brokerage",
    logo: tenant?.logoUrl ?? null,
    phone: "",
    email: owner?.email ?? "",
  };
}

async function fetchHeroPhoto(
  accessToken: string | null,
  driveFolderId: string | null
): Promise<{ base64: string; mimeType: string } | null> {
  if (!accessToken || !driveFolderId) return null;

  try {
    const photos = await listPhotosInFolder(accessToken, driveFolderId);
    if (!photos.length) return null;

    const hero = photos[0];
    if (!hero.id) return null;

    const drive = getDriveClient(accessToken);
    const res = await drive.files.get(
      { fileId: hero.id, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );

    const buffer = Buffer.from(res.data as ArrayBuffer);
    return {
      base64: buffer.toString("base64"),
      mimeType: hero.mimeType ?? "image/jpeg",
    };
  } catch (e) {
    console.error("[flyer] Failed to fetch hero photo:", e);
    return null;
  }
}

function buildFlyerPrompt(facts: ListingFacts, broker: BrokerInfo): string {
  const lines = [
    "You are a real estate marketing copywriter creating content for a property flyer.",
    "Choose the best template style and accent color based on the property:",
    "- modern: clean/contemporary homes, mid-range pricing",
    "- luxury: high-end homes, premium pricing, upscale neighborhoods",
    "- bold: investment properties, new construction, eye-catching listings",
    "",
    `Property: ${facts.address}`,
    `Location: ${facts.city}${facts.state ? `, ${facts.state}` : ""} ${facts.zip}`,
    facts.beds != null ? `Beds: ${facts.beds}` : "",
    facts.baths != null ? `Baths: ${facts.baths}` : "",
    facts.sqft != null ? `Sq Ft: ${facts.sqft.toLocaleString()}` : "",
    facts.priceDisplay ? `Price: ${facts.priceDisplay}` : "",
    facts.features ? `Features: ${facts.features}` : "",
    broker.name ? `Brokerage: ${broker.name}` : "",
    "",
    "Write compelling, professional copy. Avoid fair-housing violations.",
    "The headline should be punchy and attention-grabbing (max 60 chars).",
    "Feature bullets should highlight the most marketable aspects.",
    "CTA should drive the viewer to contact the agent or attend an open house.",
  ];
  return lines.filter(Boolean).join("\n");
}

async function uploadToDrive(
  accessToken: string,
  folderId: string,
  fileName: string,
  mimeType: string,
  buffer: Buffer
): Promise<string | null> {
  const drive = getDriveClient(accessToken);
  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    supportsAllDrives: true,
    fields: "id",
  });
  return res.data.id ?? null;
}
