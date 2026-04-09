-- Add broker contact fields to Tenant
ALTER TABLE "Tenant" ADD COLUMN "brokerPhone" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "flyerNotifyEmail" TEXT;
