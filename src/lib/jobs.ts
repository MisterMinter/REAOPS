import { Prisma, JobRunStatus, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";

type JobRunInput<T> = {
  prisma?: PrismaClient;
  kind: string;
  key: string;
  tenantId?: string | null;
  trigger?: string;
  ttlMs?: number;
  metadata?: Prisma.InputJsonValue;
  run: (jobRunId: string) => Promise<T>;
  summarize?: (result: T) => string | null | undefined;
  resultMetadata?: (result: T) => Prisma.InputJsonValue | null | undefined;
};

export type WithJobRunResult<T> =
  | { status: "ran"; jobRunId: string; result: T }
  | { status: "skipped"; jobRunId: string; result: null };

export async function withJobRun<T>(input: JobRunInput<T>): Promise<WithJobRunResult<T>> {
  const prisma = input.prisma ?? defaultPrisma;
  const owner = crypto.randomUUID();
  const ttlMs = input.ttlMs ?? 10 * 60 * 1000;
  const locked = await acquireJobLock(prisma, input.key, owner, ttlMs, input.metadata);

  if (!locked) {
    const skipped = await prisma.jobRun.create({
      data: {
        tenantId: input.tenantId ?? null,
        kind: input.kind,
        key: input.key,
        trigger: input.trigger ?? "manual",
        owner,
        status: JobRunStatus.SKIPPED,
        summary: "Skipped because another run is active.",
        metadata: input.metadata ?? Prisma.JsonNull,
        finishedAt: new Date(),
      },
    });
    return { status: "skipped", jobRunId: skipped.id, result: null };
  }

  const jobRun = await prisma.jobRun.create({
    data: {
      tenantId: input.tenantId ?? null,
      kind: input.kind,
      key: input.key,
      trigger: input.trigger ?? "manual",
      owner,
      status: JobRunStatus.RUNNING,
      metadata: input.metadata ?? Prisma.JsonNull,
    },
  });

  try {
    const result = await input.run(jobRun.id);
    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: JobRunStatus.SUCCEEDED,
        summary: input.summarize?.(result) ?? null,
        metadata: input.resultMetadata?.(result) ?? input.metadata ?? Prisma.JsonNull,
        finishedAt: new Date(),
      },
    });
    return { status: "ran", jobRunId: jobRun.id, result };
  } catch (error) {
    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: JobRunStatus.FAILED,
        error: error instanceof Error ? error.message : "Job failed.",
        finishedAt: new Date(),
      },
    });
    throw error;
  } finally {
    await releaseJobLock(prisma, input.key, owner).catch(() => undefined);
  }
}

async function acquireJobLock(
  prisma: PrismaClient,
  key: string,
  owner: string,
  ttlMs: number,
  metadata?: Prisma.InputJsonValue
) {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + ttlMs);
  const updated = await prisma.jobLock.updateMany({
    where: {
      key,
      OR: [{ lockedUntil: { lte: now } }, { owner }],
    },
    data: {
      owner,
      lockedUntil,
      metadata: metadata ?? Prisma.JsonNull,
    },
  });
  if (updated.count > 0) return true;

  const existing = await prisma.jobLock.findUnique({ where: { key }, select: { key: true } });
  if (existing) return false;

  try {
    await prisma.jobLock.create({
      data: {
        key,
        owner,
        lockedUntil,
        metadata: metadata ?? Prisma.JsonNull,
      },
    });
    return true;
  } catch {
    return false;
  }
}

async function releaseJobLock(prisma: PrismaClient, key: string, owner: string) {
  await prisma.jobLock.updateMany({
    where: { key, owner },
    data: { lockedUntil: new Date(0) },
  });
}
