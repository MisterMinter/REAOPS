import type { Prisma } from "@prisma/client";

export type MlsProviderKey = "manual-json" | "generic-reso-web-api";

export type MlsProviderConfigInput = {
  id: string;
  tenantId: string;
  providerKey: string;
  label: string;
  region?: string | null;
  config?: Prisma.JsonValue | null;
  secret?: string | null;
};

export type MlsListingInput = {
  externalId: string;
  address: string;
  shortAddress?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  price?: number | null;
  priceDisplay?: string | null;
  status?: string | null;
  daysOnMarket?: number | null;
  features?: string | null;
  notes?: string | null;
  mlsNumber?: string | null;
  listingUrl?: string | null;
  rawData?: Prisma.InputJsonValue;
};

export type MlsProviderSyncResult = {
  imported: number;
  errors: string[];
  listings: MlsListingInput[];
  metadata?: Prisma.InputJsonValue;
};

export type MlsProvider = {
  key: MlsProviderKey;
  label: string;
  description: string;
  configHelp: string;
  sync(input: MlsProviderConfigInput): Promise<MlsProviderSyncResult>;
};
