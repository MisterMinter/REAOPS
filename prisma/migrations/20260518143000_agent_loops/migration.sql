-- CreateEnum
CREATE TYPE "AgentLoopKind" AS ENUM ('DAILY_OPS', 'FOLLOW_UP_RECOVERY', 'MARKETING_PLANNING', 'COMPLIANCE_SWEEP');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "AgentLoop" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "AgentLoopKind" NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cadence" TEXT NOT NULL DEFAULT 'manual',
    "persona" TEXT,
    "config" JSONB,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentLoop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loopId" TEXT,
    "kind" "AgentLoopKind" NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "summary" TEXT,
    "observations" JSONB,
    "actions" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentLoop_tenantId_enabled_idx" ON "AgentLoop"("tenantId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AgentLoop_tenantId_kind_key" ON "AgentLoop"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "AgentRun_tenantId_startedAt_idx" ON "AgentRun"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentRun_tenantId_kind_idx" ON "AgentRun"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "AgentRun_tenantId_status_idx" ON "AgentRun"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "AgentLoop" ADD CONSTRAINT "AgentLoop_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_loopId_fkey" FOREIGN KEY ("loopId") REFERENCES "AgentLoop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
