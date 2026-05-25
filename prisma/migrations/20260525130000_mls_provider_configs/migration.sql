CREATE TABLE "MlsProviderConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "region" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'configured',
    "config" JSONB,
    "secretRef" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MlsProviderConfig_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MlsProviderConfig_tenantId_providerKey_idx" ON "MlsProviderConfig"("tenantId", "providerKey");
CREATE INDEX "MlsProviderConfig_tenantId_enabled_idx" ON "MlsProviderConfig"("tenantId", "enabled");

ALTER TABLE "MlsProviderConfig" ADD CONSTRAINT "MlsProviderConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
