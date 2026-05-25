import { Prisma, SyncRunStatus, type PrismaClient } from "@prisma/client";
import { decryptSecret } from "@/lib/crypto";
import { listDriveListingFolders } from "@/lib/drive";
import { getGoogleAccessTokenForUser } from "@/lib/google-account-token";
import { autoLinkDriveFolders } from "@/lib/marketing-listings";
import { getMlsProvider } from "@/lib/mls/registry";
import type { MlsListingInput } from "@/lib/mls/types";
import { prisma as defaultPrisma } from "@/lib/prisma";

type LoadedMlsProviderConfig = {
  id: string;
  tenantId: string;
  providerKey: string;
  label: string;
  region: string | null;
  enabled: boolean;
  config: Prisma.JsonValue | null;
  secretRef: string | null;
};

export type MlsProviderSyncSummary = {
  providerConfigId: string;
  providerKey: string;
  label: string;
  imported: number;
  upserted: number;
  errors: string[];
  durationMs: number;
};

export type TenantMlsSyncSummary = {
  providersChecked: number;
  providersSynced: number;
  imported: number;
  upserted: number;
  errors: string[];
  results: MlsProviderSyncSummary[];
};

export async function syncMlsProviderConfig(input: {
  prisma?: PrismaClient;
  configId: string;
  tenantId?: string;
  actorId?: string | null;
  force?: boolean;
}): Promise<MlsProviderSyncSummary> {
  const prisma = input.prisma ?? defaultPrisma;
  const config = await prisma.mlsProviderConfig.findFirst({
    where: {
      id: input.configId,
      tenantId: input.tenantId,
      tenant: { isActive: true },
    },
    select: {
      id: true,
      tenantId: true,
      providerKey: true,
      label: true,
      region: true,
      enabled: true,
      config: true,
      secretRef: true,
    },
  });
  if (!config) throw new Error("MLS provider config not found.");
  if (!config.enabled && !input.force) {
    return {
      providerConfigId: config.id,
      providerKey: config.providerKey,
      label: config.label,
      imported: 0,
      upserted: 0,
      errors: ["MLS provider is disabled."],
      durationMs: 0,
    };
  }

  const provider = getMlsProvider(config.providerKey);
  if (!provider) throw new Error(`MLS provider '${config.providerKey}' is not registered.`);

  const run = await prisma.syncRun.create({
    data: {
      tenantId: config.tenantId,
      provider: `mls:${config.providerKey}`,
      direction: "inbound",
      status: SyncRunStatus.RUNNING,
    },
  });

  const started = Date.now();
  const now = new Date();
  try {
    const result = await provider.sync({
      id: config.id,
      tenantId: config.tenantId,
      providerKey: config.providerKey,
      label: config.label,
      region: config.region,
      config: config.config,
      secret: decryptStoredSecret(config.secretRef),
    });

    let upserted = 0;
    for (const listing of result.listings) {
      await upsertMlsListing(prisma, config, listing, now);
      upserted += 1;
    }

    await tryAutoLinkDrive(prisma, config.tenantId);

    const errors = result.errors.slice(0, 20);
    const summary: MlsProviderSyncSummary = {
      providerConfigId: config.id,
      providerKey: config.providerKey,
      label: config.label,
      imported: result.imported,
      upserted,
      errors,
      durationMs: Date.now() - started,
    };

    await prisma.mlsProviderConfig.update({
      where: { id: config.id },
      data: {
        status: errors.length > 0 ? "degraded" : "synced",
        lastSyncedAt: now,
        lastSyncError: errors.length > 0 ? errors.slice(0, 3).join("; ") : null,
      },
    });
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: SyncRunStatus.SUCCEEDED,
        finishedAt: new Date(),
        summary: {
          ...summary,
          providerMetadata: result.metadata ?? null,
        } as Prisma.InputJsonValue,
      },
    });
    await prisma.auditEvent.create({
      data: {
        tenantId: config.tenantId,
        userId: input.actorId ?? null,
        action: "mls.sync.inbound",
        subjectType: "SyncRun",
        subjectId: run.id,
        metadata: summary as Prisma.InputJsonValue,
      },
    });

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "MLS sync failed.";
    await prisma.mlsProviderConfig.update({
      where: { id: config.id },
      data: {
        status: "error",
        lastSyncError: message,
      },
    });
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: SyncRunStatus.FAILED,
        finishedAt: new Date(),
        error: message,
      },
    });
    throw error;
  }
}

export async function syncTenantMlsProviders(input: {
  prisma?: PrismaClient;
  tenantId: string;
  actorId?: string | null;
  enabledOnly?: boolean;
}): Promise<TenantMlsSyncSummary> {
  const prisma = input.prisma ?? defaultPrisma;
  const configs = await prisma.mlsProviderConfig.findMany({
    where: {
      tenantId: input.tenantId,
      tenant: { isActive: true },
      ...(input.enabledOnly === false ? {} : { enabled: true }),
    },
    select: { id: true },
    orderBy: [{ enabled: "desc" }, { createdAt: "asc" }],
  });

  const results: MlsProviderSyncSummary[] = [];
  const errors: string[] = [];
  for (const config of configs) {
    try {
      results.push(
        await syncMlsProviderConfig({
          prisma,
          configId: config.id,
          tenantId: input.tenantId,
          actorId: input.actorId,
        })
      );
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "MLS provider sync failed.");
    }
  }

  return {
    providersChecked: configs.length,
    providersSynced: results.length,
    imported: results.reduce((sum, result) => sum + result.imported, 0),
    upserted: results.reduce((sum, result) => sum + result.upserted, 0),
    errors: [
      ...errors,
      ...results.flatMap((result) => result.errors.map((error) => `${result.label}: ${error}`)),
    ],
    results,
  };
}

async function upsertMlsListing(
  prisma: PrismaClient,
  config: LoadedMlsProviderConfig,
  listing: MlsListingInput,
  now: Date
) {
  const hubspotId = `mls:${config.providerKey}:${listing.externalId}`;
  const rawData = jsonObject({
    source: "mls",
    providerKey: config.providerKey,
    providerConfigId: config.id,
    providerLabel: config.label,
    region: config.region,
    externalId: listing.externalId,
    listingUrl: listing.listingUrl,
    providerRawData: listing.rawData,
  });

  await prisma.cachedListing.upsert({
    where: { tenantId_hubspotId: { tenantId: config.tenantId, hubspotId } },
    create: {
      tenantId: config.tenantId,
      hubspotId,
      address: listing.address.slice(0, 500),
      shortAddress: (listing.shortAddress ?? shortAddress(listing.address)).slice(0, 120),
      city: listing.city ?? "",
      state: listing.state ?? "",
      zip: listing.zip ?? null,
      beds: toInt(listing.beds),
      baths: listing.baths ?? null,
      sqft: toInt(listing.sqft),
      price: toInt(listing.price),
      priceDisplay: listing.priceDisplay ?? formatPrice(listing.price ?? null),
      status: listing.status ?? "Active",
      daysOnMarket: toInt(listing.daysOnMarket),
      features: listing.features ?? null,
      notes: listing.notes ?? null,
      mlsNumber: listing.mlsNumber ?? listing.externalId,
      driveFolderId: null,
      rawData,
      lastSyncedAt: now,
    },
    update: {
      address: listing.address.slice(0, 500),
      shortAddress: (listing.shortAddress ?? shortAddress(listing.address)).slice(0, 120),
      city: listing.city ?? "",
      state: listing.state ?? "",
      zip: listing.zip ?? null,
      beds: toInt(listing.beds),
      baths: listing.baths ?? null,
      sqft: toInt(listing.sqft),
      price: toInt(listing.price),
      priceDisplay: listing.priceDisplay ?? formatPrice(listing.price ?? null),
      status: listing.status ?? "Active",
      daysOnMarket: toInt(listing.daysOnMarket),
      features: listing.features ?? null,
      notes: listing.notes ?? null,
      mlsNumber: listing.mlsNumber ?? listing.externalId,
      rawData,
      lastSyncedAt: now,
    },
  });
}

async function tryAutoLinkDrive(prisma: PrismaClient, tenantId: string) {
  const driveCfg = await prisma.driveConfig.findUnique({
    where: { tenantId },
    select: { rootFolderId: true },
  });
  if (!driveCfg) return;

  const account = await prisma.account.findFirst({
    where: {
      provider: "google",
      user: { tenantId },
      refresh_token: { not: null },
    },
    select: { userId: true },
  });
  if (!account) return;

  const token = await getGoogleAccessTokenForUser(account.userId);
  if (!token) return;

  const driveFolders = await listDriveListingFolders(token, driveCfg.rootFolderId);
  if (!driveFolders.length) return;

  const cached = await prisma.cachedListing.findMany({
    where: { tenantId },
    select: { id: true, hubspotId: true, address: true, shortAddress: true, driveFolderId: true },
  });

  await autoLinkDriveFolders(cached, driveFolders);
}

function decryptStoredSecret(value: string | null) {
  if (!value) return null;
  try {
    return decryptSecret(value);
  } catch {
    return value;
  }
}

function jsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function toInt(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function shortAddress(value: string) {
  const comma = value.indexOf(",");
  return comma > 0 ? value.slice(0, comma).trim() : value.slice(0, 120);
}

function formatPrice(value: number | null) {
  return value == null ? "—" : `$${Math.round(value).toLocaleString("en-US")}`;
}
