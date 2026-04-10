import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getGoogleAccessTokenForUser } from "@/lib/google-account-token";
import { resolveLanguageModel } from "@/lib/ai-chat";
import { generateObject } from "ai";
import { z } from "zod";
import { getDriveClient, listPhotosInFolder } from "@/lib/drive";
import { renderFlyerHtml, type FlyerData } from "@/lib/flyer-templates";
import { renderFlyerPdf, renderFlyerPng } from "@/lib/flyer-render";
import { sendEmail } from "@/lib/gmail-send";
import { Readable } from "stream";

const flyerCopySchema = z.object({
  templateStyle: z.enum(["modern", "luxury", "bold"]),
  accentColor: z
    .string()
    .describe("Hex color that fits the property vibe, e.g. #1a3a5c"),
  headline: z.string().describe("Punchy headline, max 60 chars"),
  tagline: z.string().describe("Supporting tagline, max 120 chars"),
  featureBullets: z
    .array(z.string())
    .max(4)
    .describe("Up to 4 short feature highlights"),
  ctaText: z.string().describe("Call-to-action text, max 80 chars"),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const {
    listingId,
    templateStyle,
    action,
    recipientEmail,
  } = body as {
    listingId?: string;
    templateStyle?: "modern" | "luxury" | "bold";
    action?: "create" | "email";
    recipientEmail?: string;
  };

  const accessToken = await getGoogleAccessTokenForUser(session.user.id);
  if (!accessToken) {
    return NextResponse.json(
      { error: "No Google token. Sign out and sign back in with Google." },
      { status: 401 }
    );
  }

  const model = resolveLanguageModel();
  if (!model) {
    return NextResponse.json(
      { error: "No AI provider configured on the server." },
      { status: 500 }
    );
  }

  const tenantId = session.user.tenantId;

  const listing = listingId
    ? await prisma.cachedListing.findFirst({
        where: { id: listingId, tenantId },
      })
    : null;

  if (listingId && !listing) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }

  const facts = listing
    ? {
        address: listing.address,
        city: listing.city,
        state: listing.state,
        zip: listing.zip ?? "",
        beds: listing.beds,
        baths: listing.baths,
        sqft: listing.sqft,
        priceDisplay: listing.priceDisplay,
        features: listing.features ?? "",
      }
    : {
        address: body.address ?? "Property",
        city: body.city ?? "",
        state: body.state ?? "",
        zip: body.zip ?? "",
        beds: body.beds ?? null,
        baths: body.baths ?? null,
        sqft: body.sqft ?? null,
        priceDisplay: body.priceDisplay ?? "",
        features: body.features ?? "",
      };

  const driveFolderId = listing?.driveFolderId ?? body.driveFolderId ?? null;

  let heroImage: { base64: string; mimeType: string } | null = null;
  if (accessToken && driveFolderId) {
    try {
      const photos = await listPhotosInFolder(accessToken, driveFolderId);
      if (photos.length && photos[0].id) {
        const drive = getDriveClient(accessToken);
        const res = await drive.files.get(
          { fileId: photos[0].id, alt: "media", supportsAllDrives: true },
          { responseType: "arraybuffer" }
        );
        const buffer = Buffer.from(res.data as ArrayBuffer);
        heroImage = {
          base64: buffer.toString("base64"),
          mimeType: photos[0].mimeType ?? "image/jpeg",
        };
      }
    } catch (e) {
      console.error("[flyer-api] Failed to fetch hero photo:", e);
    }
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      brokerageName: true,
      name: true,
      logoUrl: true,
      brokerPhone: true,
      flyerNotifyEmail: true,
    },
  });

  const ownerUser = await prisma.user.findFirst({
    where: { tenantId, role: { in: ["BROKER_OWNER", "ADMIN"] } },
    select: { email: true },
  });

  const broker = {
    name: tenant?.brokerageName ?? tenant?.name ?? "Brokerage",
    logo: tenant?.logoUrl ?? null,
    phone: tenant?.brokerPhone ?? "",
    email: tenant?.flyerNotifyEmail ?? ownerUser?.email ?? "",
  };

  const promptLines = [
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

  let aiCopy;
  try {
    aiCopy = await generateObject({
      model,
      schema: flyerCopySchema,
      prompt: promptLines.filter(Boolean).join("\n"),
    });
  } catch (e) {
    console.error("[flyer-api] AI generation failed:", e);
    return NextResponse.json(
      { error: `AI generation failed: ${e instanceof Error ? e.message : "unknown"}` },
      { status: 500 }
    );
  }

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

  let pdfBuffer: Buffer;
  let pngBuffer: Buffer;
  try {
    [pdfBuffer, pngBuffer] = await Promise.all([
      renderFlyerPdf(html),
      renderFlyerPng(html),
    ]);
  } catch (e) {
    console.error("[flyer-api] Render failed:", e);
    return NextResponse.json(
      { error: `Flyer rendering failed: ${e instanceof Error ? e.message : "unknown"}` },
      { status: 500 }
    );
  }

  const shortAddr = facts.address.replace(/,.*$/, "").trim();
  const pdfName = `Flyer - ${shortAddr}.pdf`;
  const pngName = `Flyer - ${shortAddr}.png`;

  let pdfDriveId: string | null = null;
  let pngDriveId: string | null = null;

  if (accessToken && driveFolderId) {
    try {
      const drive = getDriveClient(accessToken);
      const [pdfRes, pngRes] = await Promise.all([
        drive.files.create({
          requestBody: { name: pdfName, mimeType: "application/pdf", parents: [driveFolderId] },
          media: { mimeType: "application/pdf", body: Readable.from(pdfBuffer) },
          supportsAllDrives: true,
          fields: "id",
        }),
        drive.files.create({
          requestBody: { name: pngName, mimeType: "image/png", parents: [driveFolderId] },
          media: { mimeType: "image/png", body: Readable.from(pngBuffer) },
          supportsAllDrives: true,
          fields: "id",
        }),
      ]);
      pdfDriveId = pdfRes.data.id ?? null;
      pngDriveId = pngRes.data.id ?? null;
    } catch (e) {
      console.error("[flyer-api] Drive upload failed:", e);
    }
  }

  const result: Record<string, unknown> = {
    success: true,
    templateStyle: copy.templateStyle,
    headline: copy.headline,
    pdfName,
    pngName,
    pdfDriveId,
    pngDriveId,
    pdfDriveUrl: pdfDriveId
      ? `https://drive.google.com/file/d/${pdfDriveId}/view`
      : null,
    pngDriveUrl: pngDriveId
      ? `https://drive.google.com/file/d/${pngDriveId}/view`
      : null,
    savedToDrive: !!(pdfDriveId || pngDriveId),
  };

  if (action === "email") {
    const toEmail =
      recipientEmail || tenant?.flyerNotifyEmail || null;
    if (!toEmail) {
      return NextResponse.json(
        {
          ...result,
          emailError:
            "No recipient email specified and no default flyer email configured in Settings.",
        },
        { status: 200 }
      );
    }

    try {
      const emailResult = await sendEmail({
        accessToken,
        to: toEmail,
        subject: `Property Flyer: ${shortAddr}`,
        bodyHtml: `<p>Hi,</p><p>Please find attached the property flyer for <strong>${shortAddr}</strong>.</p><p>Best regards,<br/>${broker.name}</p>`,
        pdfBuffer,
        pdfFilename: pdfName,
      });
      result.emailSent = true;
      result.emailTo = toEmail;
      result.emailMessageId = emailResult.messageId;
    } catch (e) {
      console.error("[flyer-api] Email send failed:", e);
      result.emailError = `Failed to send: ${e instanceof Error ? e.message : "unknown"}`;
    }
  }

  return NextResponse.json(result);
}
