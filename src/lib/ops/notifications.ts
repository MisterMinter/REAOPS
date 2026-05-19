import {
  AgentNotificationSeverity,
  ChannelKind,
  UserRole,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";

export async function createAgentNotifications(input: {
  prisma?: PrismaClient;
  tenantId: string;
  agentRunId?: string | null;
  title: string;
  body: string;
  href?: string | null;
  severity?: AgentNotificationSeverity;
  metadata?: Prisma.InputJsonValue;
  userIds?: string[];
}) {
  const prisma = input.prisma ?? defaultPrisma;
  const users =
    input.userIds && input.userIds.length > 0
      ? await prisma.user.findMany({
          where: {
            id: { in: input.userIds },
            tenantId: input.tenantId,
            isActive: true,
          },
          select: { id: true },
        })
      : await notificationAudience(prisma, input.tenantId);

  if (users.length === 0) return [];

  await prisma.agentNotification.createMany({
    data: users.map((user) => ({
      tenantId: input.tenantId,
      userId: user.id,
      agentRunId: input.agentRunId ?? null,
      title: input.title,
      body: input.body,
      href: input.href ?? null,
      severity: input.severity ?? AgentNotificationSeverity.INFO,
      metadata: input.metadata,
    })),
  });

  return prisma.agentNotification.findMany({
    where: {
      tenantId: input.tenantId,
      agentRunId: input.agentRunId ?? undefined,
      title: input.title,
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function markAgentNotificationRead(input: {
  prisma?: PrismaClient;
  tenantId: string;
  userId: string;
  notificationId: string;
}) {
  const prisma = input.prisma ?? defaultPrisma;
  return prisma.agentNotification.updateMany({
    where: {
      id: input.notificationId,
      tenantId: input.tenantId,
      OR: [{ userId: input.userId }, { userId: null }],
    },
    data: { readAt: new Date() },
  });
}

export async function markAgentNotificationsRead(input: {
  prisma?: PrismaClient;
  tenantId: string;
  userId: string;
}) {
  const prisma = input.prisma ?? defaultPrisma;
  return prisma.agentNotification.updateMany({
    where: {
      tenantId: input.tenantId,
      readAt: null,
      OR: [{ userId: input.userId }, { userId: null }],
    },
    data: { readAt: new Date() },
  });
}

export async function markNotificationsDelivered(input: {
  prisma?: PrismaClient;
  ids: string[];
  channel: ChannelKind;
}) {
  if (input.ids.length === 0) return { count: 0 };
  const prisma = input.prisma ?? defaultPrisma;
  return prisma.agentNotification.updateMany({
    where: { id: { in: input.ids } },
    data: {
      deliveryChannel: input.channel,
      deliveredAt: new Date(),
    },
  });
}

async function notificationAudience(prisma: PrismaClient, tenantId: string) {
  const primary = await prisma.user.findMany({
    where: {
      tenantId,
      isActive: true,
      role: { in: [UserRole.BROKER_OWNER, UserRole.ADMIN] },
    },
    select: { id: true },
  });
  if (primary.length > 0) return primary;

  return prisma.user.findMany({
    where: { tenantId, isActive: true },
    select: { id: true },
    take: 5,
  });
}
