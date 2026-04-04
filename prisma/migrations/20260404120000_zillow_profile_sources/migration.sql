-- CreateTable
CREATE TABLE "ZillowProfileSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "profileUrl" TEXT NOT NULL,
    "displayLabel" TEXT,
    "assignedUserId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZillowProfileSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ZillowProfileSource_tenantId_idx" ON "ZillowProfileSource"("tenantId");

-- AddForeignKey
ALTER TABLE "ZillowProfileSource" ADD CONSTRAINT "ZillowProfileSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZillowProfileSource" ADD CONSTRAINT "ZillowProfileSource_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
