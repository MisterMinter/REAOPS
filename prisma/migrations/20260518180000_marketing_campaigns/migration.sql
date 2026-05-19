-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "brandKit" JSONB;

-- CreateEnum
CREATE TYPE "MarketingCampaignStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MarketingCampaignItemStatus" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'SENT', 'SKIPPED');

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "listingId" TEXT,
    "sourceListingKey" TEXT,
    "cachedListingId" TEXT,
    "driveFolderId" TEXT,
    "title" TEXT NOT NULL,
    "goal" TEXT NOT NULL DEFAULT 'listing_launch',
    "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "summary" TEXT,
    "recommendedHero" TEXT,
    "brandSnapshot" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaignItem" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "assetId" TEXT,
    "stage" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "status" "MarketingCampaignItemStatus" NOT NULL DEFAULT 'DRAFT',
    "dueAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaignItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingCampaign_tenantId_status_idx" ON "MarketingCampaign"("tenantId", "status");

-- CreateIndex
CREATE INDEX "MarketingCampaign_tenantId_sourceListingKey_idx" ON "MarketingCampaign"("tenantId", "sourceListingKey");

-- CreateIndex
CREATE INDEX "MarketingCampaign_tenantId_cachedListingId_idx" ON "MarketingCampaign"("tenantId", "cachedListingId");

-- CreateIndex
CREATE INDEX "MarketingCampaign_tenantId_listingId_idx" ON "MarketingCampaign"("tenantId", "listingId");

-- CreateIndex
CREATE INDEX "MarketingCampaignItem_campaignId_dueAt_idx" ON "MarketingCampaignItem"("campaignId", "dueAt");

-- CreateIndex
CREATE INDEX "MarketingCampaignItem_assetId_idx" ON "MarketingCampaignItem"("assetId");

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaignItem" ADD CONSTRAINT "MarketingCampaignItem_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaignItem" ADD CONSTRAINT "MarketingCampaignItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MarketingAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
