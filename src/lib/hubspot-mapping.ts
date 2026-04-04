/**
 * Default HubSpot Deals → RE Agent OS field mapping.
 * Per-tenant overrides live in Tenant.hubspotListingProps (same shape).
 */
export type HubSpotListingFieldMapping = {
  address: string;
  city: string;
  state: string;
  zip: string;
  beds: string;
  baths: string;
  sqft: string;
  price: string;
  status: string;
  features: string;
  notes: string;
  mlsNumber: string;
};

export const DEFAULT_DEAL_MAPPING: HubSpotListingFieldMapping = {
  address: "address",
  city: "city",
  state: "state",
  zip: "zip",
  beds: "bedrooms",
  baths: "bathrooms",
  sqft: "square_footage",
  price: "amount",
  status: "dealstage",
  features: "key_features",
  notes: "notes",
  mlsNumber: "mls_number",
};

export function parseHubspotListingProps(raw: unknown): HubSpotListingFieldMapping {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_DEAL_MAPPING };
  const o = raw as Record<string, unknown>;
  const out = { ...DEFAULT_DEAL_MAPPING };
  for (const k of Object.keys(DEFAULT_DEAL_MAPPING) as (keyof HubSpotListingFieldMapping)[]) {
    if (typeof o[k] === "string" && o[k].trim()) out[k] = o[k].trim();
  }
  return out;
}
