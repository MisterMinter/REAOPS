-- CreateEnum
CREATE TYPE "AgentNotificationSeverity" AS ENUM ('INFO', 'ACTION', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "AgentNotification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "agentRunId" TEXT,
    "severity" "AgentNotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "deliveryChannel" "ChannelKind",
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentNotification_tenantId_createdAt_idx" ON "AgentNotification"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentNotification_tenantId_readAt_idx" ON "AgentNotification"("tenantId", "readAt");

-- CreateIndex
CREATE INDEX "AgentNotification_tenantId_userId_readAt_idx" ON "AgentNotification"("tenantId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "AgentNotification_tenantId_agentRunId_idx" ON "AgentNotification"("tenantId", "agentRunId");

-- AddForeignKey
ALTER TABLE "AgentNotification" ADD CONSTRAINT "AgentNotification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentNotification" ADD CONSTRAINT "AgentNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentNotification" ADD CONSTRAINT "AgentNotification_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
