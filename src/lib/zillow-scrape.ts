/**
 * Zillow scraping via Firecrawl structured extract (primary) with HTML fallback.
 */

import { z } from "zod";

export type ZillowProfileResult = {
  agentName: string | null;
  agentEmail: string | null;
  agentPhone: string | null;
  brokerageName: string | null;
  activeListings: ZillowProfileListing[];
  soldListings: ZillowProfileListing[];
  rentals: ZillowProfileListing[];
};

export type ZillowProfileListing = {
  zpid: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  price: string;
  status: string;
  listingUrl: string;
  thumbnailUrl: string | null;
};

export type ZillowListingDetail = {
  address: string;
  city: string;
  state: string;
  zip: string;
  price: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lotSize: string | null;
  yearBuilt: number | null;
  propertyType: string | null;
  status: string | null;
  daysOnZillow: number | null;
  mlsNumber: string | null;
  zpid: string | null;
  description: string | null;
  features: string[];
  interiorDetails: string[];
  exteriorDetails: string[];
  parking: string | null;
  heating: string | null;
  cooling: string | null;
  appliances: string[];
  flooring: string | null;
  hoaFee: string | null;
  taxAssessedValue: string | null;
  annualTax: string | null;
  schoolDistrict: string | null;
  nearbySchools: { name: string; rating: string; distance: string; grades: string }[];
  photoUrls: string[];
  virtualTourUrl: string | null;
  listingAgent: string | null;
  listingBrokerage: string | null;
  neighborhood: string | null;
  walkScore: number | null;
  transitScore: number | null;
};

const zListingItem = z.object({
  zpid: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  beds: z.number().optional(),
  baths: z.number().optional(),
  sqft: z.number().optional(),
  price: z.string().optional(),
  status: z.string().optional(),
  listingUrl: z.string().optional(),
  thumbnailUrl: z.string().optional(),
});

const PROFILE_EXTRACT_SCHEMA = z.object({
  agentName: z.string().optional(),
  agentEmail: z.string().optional(),
  agentPhone: z.string().optional(),
  brokerageName: z.string().optional(),
  activeListings: z.array(zListingItem).optional(),
  soldListings: z.array(zListingItem).optional(),
  rentals: z.array(zListingItem).optional(),
});

const LISTING_EXTRACT_SCHEMA = z.object({
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  price: z.string().optional(),
  beds: z.number().optional(),
  baths: z.number().optional(),
  sqft: z.number().optional(),
  lotSize: z.string().optional(),
  yearBuilt: z.number().optional(),
  propertyType: z.string().optional(),
  status: z.string().optional(),
  daysOnZillow: z.number().optional(),
  mlsNumber: z.string().optional(),
  zpid: z.string().optional(),
  description: z.string().optional(),
  features: z.array(z.string()).optional(),
  interiorDetails: z.array(z.string()).optional(),
  exteriorDetails: z.array(z.string()).optional(),
  parking: z.string().optional(),
  heating: z.string().optional(),
  cooling: z.string().optional(),
  appliances: z.array(z.string()).optional(),
  flooring: z.string().optional(),
  hoaFee: z.string().optional(),
  taxAssessedValue: z.string().optional(),
  annualTax: z.string().optional(),
  schoolDistrict: z.string().optional(),
  nearbySchools: z
    .array(
      z.object({
        name: z.string().optional(),
        rating: z.string().optional(),
        distance: z.string().optional(),
        grades: z.string().optional(),
      })
    )
    .optional(),
  photoUrls: z.array(z.string()).optional(),
  virtualTourUrl: z.string().optional(),
  listingAgent: z.string().optional(),
  listingBrokerage: z.string().optional(),
  neighborhood: z.string().optional(),
  walkScore: z.number().optional(),
  transitScore: z.number().optional(),
});

function requireFirecrawl() {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "FIRECRAWL_API_KEY is required for Zillow scraping. Sign up at firecrawl.dev and add the key in Railway env vars."
    );
  }
  return key;
}

function validateZillowUrl(raw: string): string {
  const url = raw.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error("URL must start with http(s)://");
  }
  const u = new URL(url);
  if (!u.hostname.endsWith("zillow.com")) {
    throw new Error("Only zillow.com URLs are supported");
  }
  return url;
}

async function getFirecrawlApp() {
  const key = requireFirecrawl();
  const FirecrawlApp = (await import("@mendable/firecrawl-js")).default;
  return new FirecrawlApp({ apiKey: key });
}

export async function scrapeZillowProfile(profileUrl: string): Promise<ZillowProfileResult> {
  const url = validateZillowUrl(profileUrl);
  const app = await getFirecrawlApp();

  const result = await app.scrapeUrl(url, {
    formats: ["extract"],
    extract: { schema: PROFILE_EXTRACT_SCHEMA },
    waitFor: 3000,
  });

  if (!result.success) {
    throw new Error(`Firecrawl profile scrape failed: ${result.error ?? "unknown"}`);
  }

  const data = (result.extract ?? {}) as Record<string, unknown>;

  return {
    agentName: str(data.agentName),
    agentEmail: str(data.agentEmail),
    agentPhone: str(data.agentPhone),
    brokerageName: str(data.brokerageName),
    activeListings: normalizeListings(data.activeListings, "For Sale"),
    soldListings: normalizeListings(data.soldListings, "Sold"),
    rentals: normalizeListings(data.rentals, "For Rent"),
  };
}

export async function scrapeZillowListingDetail(listingUrl: string): Promise<ZillowListingDetail> {
  const url = validateZillowUrl(listingUrl);
  const app = await getFirecrawlApp();

  const result = await app.scrapeUrl(url, {
    formats: ["extract"],
    extract: { schema: LISTING_EXTRACT_SCHEMA },
    waitFor: 3000,
  });

  if (!result.success) {
    throw new Error(`Firecrawl listing scrape failed: ${result.error ?? "unknown"}`);
  }

  const d = (result.extract ?? {}) as Record<string, unknown>;

  return {
    address: str(d.address) ?? "",
    city: str(d.city) ?? "",
    state: str(d.state) ?? "",
    zip: str(d.zip) ?? "",
    price: str(d.price) ?? "—",
    beds: num(d.beds),
    baths: num(d.baths),
    sqft: num(d.sqft),
    lotSize: str(d.lotSize),
    yearBuilt: num(d.yearBuilt),
    propertyType: str(d.propertyType),
    status: str(d.status),
    daysOnZillow: num(d.daysOnZillow),
    mlsNumber: str(d.mlsNumber),
    zpid: str(d.zpid),
    description: str(d.description),
    features: strArr(d.features),
    interiorDetails: strArr(d.interiorDetails),
    exteriorDetails: strArr(d.exteriorDetails),
    parking: str(d.parking),
    heating: str(d.heating),
    cooling: str(d.cooling),
    appliances: strArr(d.appliances),
    flooring: str(d.flooring),
    hoaFee: str(d.hoaFee),
    taxAssessedValue: str(d.taxAssessedValue),
    annualTax: str(d.annualTax),
    schoolDistrict: str(d.schoolDistrict),
    nearbySchools: Array.isArray(d.nearbySchools)
      ? (d.nearbySchools as Record<string, unknown>[]).map((s) => ({
          name: str(s.name) ?? "",
          rating: str(s.rating) ?? "",
          distance: str(s.distance) ?? "",
          grades: str(s.grades) ?? "",
        }))
      : [],
    photoUrls: strArr(d.photoUrls),
    virtualTourUrl: str(d.virtualTourUrl),
    listingAgent: str(d.listingAgent),
    listingBrokerage: str(d.listingBrokerage),
    neighborhood: str(d.neighborhood),
    walkScore: num(d.walkScore),
    transitScore: num(d.transitScore),
  };
}

// --- Legacy HTML-based fallback (kept for non-Firecrawl environments) ---

export type ZillowParsedListing = {
  zpid: string;
  listingUrl: string;
  addressGuess: string;
};

export function parseZillowListingHints(html: string): ZillowParsedListing[] {
  const byZpid = new Map<string, ZillowParsedListing>();

  const hrefRe =
    /href="(https?:\/\/www\.zillow\.com\/homedetails\/[^"]+|\/homedetails\/[^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const raw = m[1].replace(/&amp;/g, "&");
    const z = raw.match(/(\d{6,})_zpid/i);
    if (!z) continue;
    const zpid = z[1];
    const listingUrl = raw.startsWith("http")
      ? raw
      : `https://www.zillow.com${raw.startsWith("/") ? "" : "/"}${raw}`;
    const pathMatch = raw.match(/homedetails\/(.+)/i);
    const addressGuess = pathMatch ? slugToGuess(pathMatch[1]) : `Listing ${zpid}`;
    byZpid.set(zpid, { zpid, listingUrl, addressGuess });
  }

  const looseRe = /\/homedetails\/[a-zA-Z0-9\-_%/]+?(\d{6,})_zpid/gi;
  while ((m = looseRe.exec(html)) !== null) {
    const zpid = m[1];
    if (byZpid.has(zpid)) continue;
    const full = m[0];
    const listingUrl = `https://www.zillow.com${full}`;
    byZpid.set(zpid, {
      zpid,
      listingUrl,
      addressGuess: slugToGuess(full.replace(/^\/homedetails\//i, "")),
    });
  }

  const zpidJsonRe = /"zpid"\s*:\s*"?(\d{6,})"?/g;
  while ((m = zpidJsonRe.exec(html)) !== null) {
    const zpid = m[1];
    if (byZpid.has(zpid)) continue;
    byZpid.set(zpid, {
      zpid,
      listingUrl: `https://www.zillow.com/homedetails/${zpid}_zpid/`,
      addressGuess: `Listing ${zpid}`,
    });
  }

  return [...byZpid.values()];
}

export async function fetchZillowProfileHtml(profileUrl: string): Promise<string> {
  const url = validateZillowUrl(profileUrl);

  if (process.env.FIRECRAWL_API_KEY?.trim()) {
    try {
      const app = await getFirecrawlApp();
      const result = await app.scrapeUrl(url, { formats: ["html"], waitFor: 3000 });
      if (result.success && result.html) return result.html;
    } catch (e) {
      console.warn("Firecrawl HTML fallback failed:", e instanceof Error ? e.message : e);
    }
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    cache: "no-store",
  });

  if (res.status === 403 || res.status === 401) {
    throw new Error(
      "Zillow denied access (HTTP 403/401). Set FIRECRAWL_API_KEY for proxy-based scraping."
    );
  }
  if (!res.ok) throw new Error(`Zillow HTTP ${res.status}`);
  return res.text();
}

// --- Helpers ---

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && !isNaN(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[,$]/g, ""));
    return isNaN(n) ? null : n;
  }
  return null;
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function slugToGuess(slug: string): string {
  const parts = slug.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? slug;
  const noZpid = last.replace(/_\d+_zpid\/?$/i, "").replace(/_zpid\/?$/i, "");
  try {
    return decodeURIComponent(noZpid.replace(/-/g, " ").replace(/_/g, " "));
  } catch {
    return noZpid.replace(/-/g, " ");
  }
}

function normalizeListings(
  raw: unknown,
  defaultStatus: string
): ZillowProfileListing[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .filter((item) => str(item.zpid) || str(item.listingUrl))
    .map((item) => ({
      zpid: str(item.zpid) ?? "",
      address: str(item.address) ?? "",
      city: str(item.city) ?? "",
      state: str(item.state) ?? "",
      zip: str(item.zip) ?? "",
      beds: num(item.beds),
      baths: num(item.baths),
      sqft: num(item.sqft),
      price: str(item.price) ?? "—",
      status: str(item.status) ?? defaultStatus,
      listingUrl: str(item.listingUrl) ?? "",
      thumbnailUrl: str(item.thumbnailUrl),
    }));
}
