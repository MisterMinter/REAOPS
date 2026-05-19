import {
  MarketingAssetType,
  MarketingCampaignItemStatus,
  MarketingCampaignStatus,
  MessageRisk,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { generateObject } from "ai";
import { z } from "zod";
import { resolveLanguageModel } from "@/lib/ai-chat";
import { brandKitToJson, parseBrandKit, type BrandKit } from "@/lib/marketing/brand-kit";
import type { ListingFacts } from "@/lib/marketing-generate";
import { createFollowUpTask, generateMarketingAsset, type Actor } from "@/lib/ops/workflows";
import { prisma as defaultPrisma } from "@/lib/prisma";

const launchPackSchema = z.object({
  campaignSummary: z.string(),
  recommendedHero: z.string(),
  mlsCopy: z.string(),
  socialFeedCaption: z.string(),
  storyCopy: z.string(),
  carouselSlides: z.array(z.string()).min(3).max(6),
  emailSubject: z.string(),
  emailBody: z.string(),
  openHouseCopy: z.string(),
  buyerFollowUpScript: z.string(),
  sellerUpdate: z.string(),
  cardLine: z.string(),
});

export type LaunchPackInput = {
  prisma?: PrismaClient;
  actor: Actor;
  sourceListingKey: string;
  cachedListingId?: string | null;
  driveFolderId?: string | null;
  facts: ListingFacts;
  goal?: string;
  heroContext?: string | null;
  photoNames?: string[];
  provider?: string | null;
};

export type LaunchPackResult = Awaited<ReturnType<typeof createListingLaunchPack>>;

export async function createListingLaunchPack(input: LaunchPackInput) {
  const prisma = input.prisma ?? defaultPrisma;
  const tenant = await prisma.tenant.findUnique({
    where: { id: input.actor.tenantId },
    select: {
      name: true,
      brokerageName: true,
      defaultTone: true,
      brandKit: true,
    },
  });
  const brandKit = parseBrandKit(tenant?.brandKit);
  const listing = await resolveListing(prisma, input.actor.tenantId, input.cachedListingId);
  const pack = await generateLaunchPackCopy({
    facts: input.facts,
    brandKit,
    brokerageName: tenant?.brokerageName ?? tenant?.name ?? "Brokerage",
    tone: tenant?.defaultTone ?? "Warm but professional. First-name basis. No pressure.",
    goal: input.goal ?? "listing_launch",
    heroContext: input.heroContext,
    photoNames: input.photoNames ?? [],
    provider: input.provider,
  });

  const campaign = await prisma.marketingCampaign.create({
    data: {
      tenantId: input.actor.tenantId,
      listingId: listing?.id ?? null,
      sourceListingKey: input.sourceListingKey,
      cachedListingId: input.cachedListingId ?? null,
      driveFolderId: input.driveFolderId ?? null,
      title: `${campaignGoalLabel(input.goal)} - ${input.facts.address}`,
      goal: input.goal ?? "listing_launch",
      status: MarketingCampaignStatus.ACTIVE,
      summary: pack.campaignSummary,
      recommendedHero: pack.recommendedHero,
      brandSnapshot: brandKitToJson(brandKit),
      metadata: {
        facts: input.facts,
        photoNames: input.photoNames ?? [],
      } as Prisma.InputJsonValue,
    },
  });

  const assets = await createCampaignAssets({
    prisma,
    actor: input.actor,
    campaignId: campaign.id,
    listingId: listing?.id ?? null,
    cachedListingId: input.cachedListingId ?? null,
    facts: input.facts,
    pack,
  });

  const now = new Date();
  const itemInputs = [
    {
      stage: "Launch control",
      channel: "workflow",
      title: "Review and approve launch pack",
      content: pack.campaignSummary,
      status: MarketingCampaignItemStatus.NEEDS_REVIEW,
      dueAt: addDays(now, 0),
    },
    {
      stage: "Creative",
      channel: "flyer",
      title: "Create print flyer and social PNG",
      content:
        "Use the Property Flyer action to render a print-ready PDF and social image from the approved launch pack.",
      status: MarketingCampaignItemStatus.NEEDS_REVIEW,
      dueAt: addDays(now, 0),
    },
    {
      stage: "Listing copy",
      channel: "MLS",
      title: "Publish MLS/public remarks",
      content: pack.mlsCopy,
      assetId: assets.mls.id,
      status: MarketingCampaignItemStatus.NEEDS_REVIEW,
      dueAt: addDays(now, 0),
    },
    {
      stage: "Awareness",
      channel: "social_feed",
      title: "Post primary social caption",
      content: pack.socialFeedCaption,
      assetId: assets.social.id,
      status: MarketingCampaignItemStatus.NEEDS_REVIEW,
      dueAt: addDays(now, 1),
    },
    {
      stage: "Awareness",
      channel: "social_story",
      title: "Post story sequence",
      content: pack.storyCopy,
      assetId: assets.story.id,
      status: MarketingCampaignItemStatus.NEEDS_REVIEW,
      dueAt: addDays(now, 1),
    },
    {
      stage: "Direct outreach",
      channel: "email",
      title: "Send listing email blast",
      content: `Subject: ${pack.emailSubject}\n\n${pack.emailBody}`,
      assetId: assets.email.id,
      status: MarketingCampaignItemStatus.NEEDS_REVIEW,
      dueAt: addDays(now, 2),
    },
    {
      stage: "Open house",
      channel: "social_email",
      title: "Publish open house push",
      content: pack.openHouseCopy,
      assetId: assets.openHouse.id,
      status: MarketingCampaignItemStatus.NEEDS_REVIEW,
      dueAt: addDays(now, 3),
    },
    {
      stage: "Revenue recovery",
      channel: "script",
      title: "Use buyer follow-up script",
      content: pack.buyerFollowUpScript,
      assetId: assets.followUp.id,
      status: MarketingCampaignItemStatus.NEEDS_REVIEW,
      dueAt: addDays(now, 4),
    },
    {
      stage: "Seller communication",
      channel: "seller_update",
      title: "Send seller marketing update",
      content: pack.sellerUpdate,
      assetId: assets.seller.id,
      status: MarketingCampaignItemStatus.NEEDS_REVIEW,
      dueAt: addDays(now, 7),
    },
  ];

  for (const item of itemInputs) {
    await prisma.marketingCampaignItem.create({
      data: {
        campaignId: campaign.id,
        assetId: item.assetId ?? null,
        stage: item.stage,
        channel: item.channel,
        title: item.title,
        content: item.content,
        status: item.status,
        dueAt: item.dueAt,
      },
    });
  }

  await createCampaignFollowUpTasks({
    prisma,
    actor: input.actor,
    listingId: listing?.id ?? null,
    facts: input.facts,
    pack,
    campaignId: campaign.id,
    now,
  });

  return prisma.marketingCampaign.findUniqueOrThrow({
    where: { id: campaign.id },
    include: {
      items: {
        include: { asset: true },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      },
    },
  });
}

async function createCampaignFollowUpTasks(input: {
  prisma: PrismaClient;
  actor: Actor;
  listingId: string | null;
  facts: ListingFacts;
  pack: z.infer<typeof launchPackSchema>;
  campaignId: string;
  now: Date;
}) {
  await createFollowUpTask({
    prisma: input.prisma,
    actor: input.actor,
    listingId: input.listingId,
    title: `Review buyer follow-up for ${input.facts.address}`,
    context: `${input.pack.buyerFollowUpScript}\n\nCampaign: ${input.campaignId}`,
    source: "marketing_campaign",
    dueAt: addDays(input.now, 4),
    risk: MessageRisk.LOW,
    priority: 2,
  });
  await createFollowUpTask({
    prisma: input.prisma,
    actor: input.actor,
    listingId: input.listingId,
    title: `Send seller marketing update for ${input.facts.address}`,
    context: `${input.pack.sellerUpdate}\n\nCampaign: ${input.campaignId}`,
    source: "marketing_campaign",
    dueAt: addDays(input.now, 7),
    risk: MessageRisk.MEDIUM,
    priority: 2,
  });
}

async function createCampaignAssets(input: {
  prisma: PrismaClient;
  actor: Actor;
  campaignId: string;
  listingId: string | null;
  cachedListingId: string | null;
  facts: ListingFacts;
  pack: z.infer<typeof launchPackSchema>;
}) {
  const commonMetadata = {
    generatedBy: "listing_launch_pack",
    campaignId: input.campaignId,
    cachedListingId: input.cachedListingId,
    address: input.facts.address,
  };
  const mls = await generateMarketingAsset({
    prisma: input.prisma,
    actor: input.actor,
    listingId: input.listingId,
    type: MarketingAssetType.MLS_COPY,
    title: `MLS remarks - ${input.facts.address}`,
    content: input.pack.mlsCopy,
    metadata: commonMetadata,
  });
  const social = await generateMarketingAsset({
    prisma: input.prisma,
    actor: input.actor,
    listingId: input.listingId,
    type: MarketingAssetType.SOCIAL_COPY,
    title: `Feed caption - ${input.facts.address}`,
    content: [input.pack.socialFeedCaption, "", "Carousel:", ...input.pack.carouselSlides].join("\n"),
    metadata: commonMetadata,
  });
  const story = await generateMarketingAsset({
    prisma: input.prisma,
    actor: input.actor,
    listingId: input.listingId,
    type: MarketingAssetType.SOCIAL_COPY,
    title: `Story sequence - ${input.facts.address}`,
    content: input.pack.storyCopy,
    metadata: { ...commonMetadata, format: "story" },
  });
  const email = await generateMarketingAsset({
    prisma: input.prisma,
    actor: input.actor,
    listingId: input.listingId,
    type: MarketingAssetType.EMAIL_COPY,
    title: `Email blast - ${input.facts.address}`,
    content: `Subject: ${input.pack.emailSubject}\n\n${input.pack.emailBody}`,
    metadata: commonMetadata,
  });
  const openHouse = await generateMarketingAsset({
    prisma: input.prisma,
    actor: input.actor,
    listingId: input.listingId,
    type: MarketingAssetType.SOCIAL_COPY,
    title: `Open house push - ${input.facts.address}`,
    content: input.pack.openHouseCopy,
    metadata: { ...commonMetadata, format: "open_house" },
  });
  const followUp = await generateMarketingAsset({
    prisma: input.prisma,
    actor: input.actor,
    listingId: input.listingId,
    type: MarketingAssetType.EMAIL_COPY,
    title: `Buyer follow-up script - ${input.facts.address}`,
    content: input.pack.buyerFollowUpScript,
    metadata: { ...commonMetadata, format: "follow_up_script" },
  });
  const seller = await generateMarketingAsset({
    prisma: input.prisma,
    actor: input.actor,
    listingId: input.listingId,
    type: MarketingAssetType.EMAIL_COPY,
    title: `Seller update - ${input.facts.address}`,
    content: input.pack.sellerUpdate,
    metadata: { ...commonMetadata, format: "seller_update" },
  });
  return { mls, social, story, email, openHouse, followUp, seller };
}

async function generateLaunchPackCopy(input: {
  facts: ListingFacts;
  brandKit: BrandKit;
  brokerageName: string;
  tone: string;
  goal: string;
  heroContext?: string | null;
  photoNames: string[];
  provider?: string | null;
}) {
  const model = resolveLanguageModel(input.provider);
  if (!model) return fallbackLaunchPack(input);

  try {
    const result = await generateObject({
      model,
      schema: launchPackSchema,
      system:
        "You are REAOPS, a senior real estate listing marketing operator. Create accurate, useful, fair-housing-safe launch assets. Do not imply protected-class preferences. Make the output polished enough for a brokerage owner to approve with light edits.",
      prompt: [
        `Brokerage: ${input.brokerageName}`,
        `Tone: ${input.tone}`,
        `Brand style: ${input.brandKit.fontStyle}`,
        `Brand colors: primary ${input.brandKit.primaryColor}, accent ${input.brandKit.accentColor}`,
        input.brandKit.slogan ? `Slogan: ${input.brandKit.slogan}` : "",
        `Required disclaimer: ${input.brandKit.disclaimer}`,
        `Campaign goal: ${input.goal}`,
        "",
        "Listing facts:",
        JSON.stringify(input.facts, null, 2),
        "",
        `Hero context: ${input.heroContext || "No hero image selected."}`,
        input.photoNames.length > 0 ? `Available photo names: ${input.photoNames.join(", ")}` : "",
        "",
        "Create a full listing launch pack: MLS remarks, feed caption, story copy, carousel slide text, email blast, open house push, buyer follow-up script, seller update, and one short graphic card line.",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    return result.object;
  } catch (e) {
    console.error("[marketing-launch-pack] AI generation failed:", e);
    return fallbackLaunchPack(input);
  }
}

function fallbackLaunchPack(input: {
  facts: ListingFacts;
  brandKit: BrandKit;
  brokerageName: string;
  goal: string;
}) {
  const location = [input.facts.city, input.facts.state].filter(Boolean).join(", ");
  const factsLine = [
    input.facts.beds != null ? `${input.facts.beds} beds` : null,
    input.facts.baths != null ? `${input.facts.baths} baths` : null,
    input.facts.sqft != null ? `${input.facts.sqft.toLocaleString()} sq ft` : null,
  ]
    .filter(Boolean)
    .join(" | ");
  return {
    campaignSummary: `Launch pack for ${input.facts.address}: position the listing around its strongest features, push a clean social/email rollout, and create follow-up momentum within the first week.`,
    recommendedHero: "Use the strongest exterior or main living-space photo with bright natural light.",
    mlsCopy: `${input.facts.address} offers a polished opportunity in ${location || "the local market"}. ${factsLine} ${
      input.facts.priceDisplay ? `Offered at ${input.facts.priceDisplay}.` : ""
    } ${input.facts.features || ""}\n\n${input.brandKit.disclaimer}`.trim(),
    socialFeedCaption: `Just listed: ${input.facts.address}. ${factsLine}. Message us for details or to schedule a private showing.\n\n${input.brandKit.disclaimer}`,
    storyCopy: `Frame 1: Just listed\nFrame 2: ${input.facts.address}\nFrame 3: ${factsLine}\nFrame 4: Message us to schedule a showing.`,
    carouselSlides: [
      `Just listed: ${input.facts.address}`,
      factsLine || input.facts.priceDisplay || "Property highlights",
      input.facts.features || "Tour-worthy details throughout",
      "Message us for a private showing",
    ],
    emailSubject: `Just listed: ${input.facts.address}`,
    emailBody: `Hi,\n\nWe wanted to share ${input.facts.address}, now available in ${location || "the area"}. ${factsLine}. Reply here if you would like details or a private showing.\n\n${input.brandKit.disclaimer}`,
    openHouseCopy: `Open house push: ${input.facts.address}. Share the flyer, invite active buyers, and follow up with every attendee within 24 hours.`,
    buyerFollowUpScript: `Hi, I wanted to follow up on ${input.facts.address}. Would you like the details, a private showing, or similar options nearby?`,
    sellerUpdate: `Marketing update: launch assets are drafted for ${input.facts.address}, including MLS copy, social captions, email copy, flyer workflow, and buyer follow-up script. Next step is approval and publication.`,
    cardLine: `${input.facts.address}: ${input.facts.priceDisplay || "New listing"}`,
  };
}

async function resolveListing(
  prisma: PrismaClient,
  tenantId: string,
  cachedListingId?: string | null
) {
  if (!cachedListingId) return null;
  const cached = await prisma.cachedListing.findFirst({
    where: { id: cachedListingId, tenantId },
    select: { hubspotId: true },
  });
  if (!cached) return null;
  return prisma.listing.findFirst({
    where: {
      tenantId,
      sourceSystem: "cached_listing",
      externalId: cached.hubspotId,
    },
    select: { id: true },
  });
}

function campaignGoalLabel(goal?: string) {
  if (goal === "open_house") return "Open house campaign";
  if (goal === "price_improvement") return "Price improvement campaign";
  if (goal === "stale_listing_recovery") return "Stale listing recovery";
  return "Listing launch";
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
