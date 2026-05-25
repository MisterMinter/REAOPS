import type { Prisma } from "@prisma/client";
import type {
  MlsListingInput,
  MlsProvider,
  MlsProviderConfigInput,
  MlsProviderKey,
} from "@/lib/mls/types";

const providers: Record<MlsProviderKey, MlsProvider> = {
  "manual-json": {
    key: "manual-json",
    label: "Manual JSON import",
    description: "Operational fallback for CSV/API exports pasted into provider config as listing JSON.",
    configHelp: "Use config.listings as an array of normalized listing objects. No secret required.",
    sync: async (input) => {
      const config = objectFrom(input.config);
      const rawListings = Array.isArray(config.listings) ? config.listings : [];
      const listings = rawListings.map(normalizeManualListing).filter(Boolean) as MlsListingInput[];
      return {
        imported: listings.length,
        listings,
        errors: rawListings.length === 0 ? ["No config.listings array found."] : [],
        metadata: { source: "manual-json", configuredListings: rawListings.length },
      };
    },
  },
  "generic-reso-web-api": {
    key: "generic-reso-web-api",
    label: "Generic RESO Web API",
    description: "Scaffold for MLS vendors exposing RESO/OData-style Property resources.",
    configHelp:
      "Set config.baseUrl to the vendor Property endpoint or base API URL. Optional config.query is appended. Store bearer/API token in the provider secret.",
    sync: syncGenericReso,
  },
};

export function listMlsProviders() {
  return Object.values(providers);
}

export function getMlsProvider(key: string): MlsProvider | null {
  return (providers as Record<string, MlsProvider>)[key] ?? null;
}

async function syncGenericReso(input: MlsProviderConfigInput) {
  const config = objectFrom(input.config);
  const baseUrl = stringFrom(config.baseUrl) ?? stringFrom(config.endpoint);
  if (!baseUrl) {
    return {
      imported: 0,
      listings: [],
      errors: ["config.baseUrl is required for generic-reso-web-api."],
      metadata: { source: "generic-reso-web-api" },
    };
  }

  const url = buildResoUrl(baseUrl, stringFrom(config.query));
  const headers = new Headers({ Accept: "application/json" });
  if (input.secret) headers.set("Authorization", bearerValue(input.secret));
  const res = await fetch(url, { headers });
  const data = await res.json().catch(() => ({}));
  const dataObj = objectFrom(data);
  if (!res.ok) {
    return {
      imported: 0,
      listings: [],
      errors: [`RESO request failed (${res.status}): ${stringFrom(dataObj.error) ?? stringFrom(dataObj.message) ?? res.statusText}`],
      metadata: { source: "generic-reso-web-api", url },
    };
  }

  const rows = Array.isArray(dataObj.value)
    ? dataObj.value
    : Array.isArray(dataObj.results)
      ? dataObj.results
      : Array.isArray(data)
        ? data
        : [];
  const listings = rows.map(normalizeResoListing).filter(Boolean) as MlsListingInput[];
  return {
    imported: listings.length,
    listings,
    errors: listings.length === 0 ? ["No listing rows were returned by the provider."] : [],
    metadata: { source: "generic-reso-web-api", url, rowCount: rows.length },
  };
}

function normalizeManualListing(raw: unknown): MlsListingInput | null {
  const obj = objectFrom(raw);
  const externalId = stringFrom(obj.externalId) ?? stringFrom(obj.mlsNumber) ?? stringFrom(obj.listingId);
  const address = stringFrom(obj.address);
  if (!externalId || !address) return null;
  return {
    externalId,
    address,
    shortAddress: stringFrom(obj.shortAddress) ?? shortAddress(address),
    city: stringFrom(obj.city),
    state: stringFrom(obj.state),
    zip: stringFrom(obj.zip),
    beds: numberFrom(obj.beds),
    baths: numberFrom(obj.baths),
    sqft: numberFrom(obj.sqft),
    price: numberFrom(obj.price),
    priceDisplay: stringFrom(obj.priceDisplay) ?? formatPrice(numberFrom(obj.price)),
    status: stringFrom(obj.status) ?? "Active",
    daysOnMarket: numberFrom(obj.daysOnMarket),
    features: stringFrom(obj.features),
    notes: stringFrom(obj.notes),
    mlsNumber: stringFrom(obj.mlsNumber) ?? externalId,
    listingUrl: stringFrom(obj.listingUrl),
    rawData: jsonValue(obj),
  };
}

function normalizeResoListing(raw: unknown): MlsListingInput | null {
  const obj = objectFrom(raw);
  const externalId =
    stringFrom(obj.ListingKey) ??
    stringFrom(obj.ListingId) ??
    stringFrom(obj.MlsNumber) ??
    stringFrom(obj.listingId);
  const address =
    stringFrom(obj.UnparsedAddress) ??
    [obj.StreetNumber, obj.StreetDirPrefix, obj.StreetName, obj.StreetSuffix]
      .map((part) => stringFrom(part))
      .filter(Boolean)
      .join(" ");
  if (!externalId || !address) return null;

  const price = numberFrom(obj.ListPrice) ?? numberFrom(obj.CurrentPrice);
  const remarks = stringFrom(obj.PublicRemarks);
  return {
    externalId,
    address,
    shortAddress: shortAddress(address),
    city: stringFrom(obj.City),
    state: stringFrom(obj.StateOrProvince),
    zip: stringFrom(obj.PostalCode),
    beds: numberFrom(obj.BedroomsTotal),
    baths: numberFrom(obj.BathroomsTotalDecimal) ?? numberFrom(obj.BathroomsTotalInteger),
    sqft: numberFrom(obj.LivingArea),
    price,
    priceDisplay: formatPrice(price),
    status: stringFrom(obj.StandardStatus) ?? stringFrom(obj.MlsStatus) ?? "Active",
    daysOnMarket: numberFrom(obj.DaysOnMarket),
    features: remarks,
    notes: remarks,
    mlsNumber: stringFrom(obj.ListingId) ?? stringFrom(obj.MlsNumber),
    listingUrl: stringFrom(obj.ListingURL) ?? stringFrom(obj.VirtualTourURLUnbranded),
    rawData: jsonValue(obj),
  };
}

function buildResoUrl(baseUrl: string, query?: string | null) {
  const url = new URL(baseUrl);
  if (query?.trim()) {
    const params = new URLSearchParams(query);
    for (const [key, value] of params.entries()) url.searchParams.set(key, value);
  } else if (!url.searchParams.has("$top")) {
    url.searchParams.set("$top", "100");
  }
  return url.toString();
}

function bearerValue(secret: string) {
  return /^bearer\s+/i.test(secret) ? secret : `Bearer ${secret}`;
}

function objectFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function stringFrom(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function shortAddress(value: string) {
  const comma = value.indexOf(",");
  return comma > 0 ? value.slice(0, comma).trim() : value.slice(0, 120);
}

function formatPrice(value: number | null) {
  return value == null ? "—" : `$${Math.round(value).toLocaleString("en-US")}`;
}
