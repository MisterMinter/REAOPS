/**
 * Zillow scraping via Firecrawl v2 API.
 *
 * Profile scrape:  single /v2/scrape  → JSON extraction + markdown fallback
 * Listing details: /v2/batch/scrape   → concurrent JSON extraction for all URLs
 * Listing detail:  single /v2/scrape  → JSON extraction for one URL (fallback)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export type ZillowParsedListing = {
  zpid: string;
  listingUrl: string;
  addressGuess: string;
};

// ---------------------------------------------------------------------------
// Firecrawl v2 JSON schemas — split per best practices (<=15 fields each)
// ---------------------------------------------------------------------------

const PROFILE_SCHEMA = {
  type: "object" as const,
  properties: {
    agentName: {
      type: ["string", "null"],
      description: "Agent's full name as shown on the profile page. Return null if not found.",
    },
    agentEmail: {
      type: ["string", "null"],
      description: "Agent's email address from the contact section. Return null if not found.",
    },
    agentPhone: {
      type: ["string", "null"],
      description: "Agent's phone number from the contact section. Return null if not found.",
    },
    brokerageName: {
      type: ["string", "null"],
      description: "Brokerage or team name shown under the agent's name. Return null if not found.",
    },
    activeListings: {
      type: "array" as const,
      description: "All currently active / for-sale listings shown on the profile. Extract ALL listings, do not skip any.",
      items: {
        type: "object" as const,
        properties: {
          zpid: { type: "string", description: "Zillow property ID (numeric string from the listing URL, e.g. '123456789'). Return null if not visible." },
          address: { type: "string", description: "Full street address of the property." },
          city: { type: ["string", "null"], description: "City name. Return null if not shown." },
          state: { type: ["string", "null"], description: "Two-letter state code. Return null if not shown." },
          zip: { type: ["string", "null"], description: "ZIP code. Return null if not shown." },
          beds: { type: ["number", "null"], description: "Number of bedrooms. Return null if not shown." },
          baths: { type: ["number", "null"], description: "Number of bathrooms. Return null if not shown." },
          sqft: { type: ["number", "null"], description: "Square footage. Return null if not shown." },
          price: { type: "string", description: "Listing price as displayed (e.g. '$450,000')." },
          status: { type: "string", description: "Listing status: 'For Sale', 'Pending', 'Coming Soon', etc." },
          listingUrl: { type: "string", description: "Full Zillow URL to the listing detail page (https://www.zillow.com/homedetails/...)." },
          thumbnailUrl: { type: ["string", "null"], description: "URL of the listing's thumbnail image. Return null if not visible." },
        },
      },
    },
    soldListings: {
      type: "array" as const,
      description: "Recently sold listings shown on the profile.",
      items: {
        type: "object" as const,
        properties: {
          zpid: { type: "string" },
          address: { type: "string" },
          price: { type: "string" },
          listingUrl: { type: "string" },
        },
      },
    },
    rentals: {
      type: "array" as const,
      description: "Rental listings shown on the profile.",
      items: {
        type: "object" as const,
        properties: {
          zpid: { type: "string" },
          address: { type: "string" },
          price: { type: "string" },
          listingUrl: { type: "string" },
          beds: { type: ["number", "null"] },
          baths: { type: ["number", "null"] },
        },
      },
    },
  },
};

/**
 * Listing detail: basic facts (≤15 fields).
 * Scraped first, cheapest extraction.
 */
const LISTING_BASIC_SCHEMA = {
  type: "object" as const,
  properties: {
    address: { type: ["string", "null"], description: "Full street address from the page header. Return null if not found." },
    city: { type: ["string", "null"], description: "City name from the address line. Return null if not found." },
    state: { type: ["string", "null"], description: "Two-letter state code. Return null if not found." },
    zip: { type: ["string", "null"], description: "ZIP code. Return null if not found." },
    price: { type: ["string", "null"], description: "Current listing price as displayed (e.g. '$450,000'). Return null if not found." },
    beds: { type: ["number", "null"], description: "Number of bedrooms from the facts section. Return null if not found." },
    baths: { type: ["number", "null"], description: "Number of bathrooms from the facts section. Return null if not found." },
    sqft: { type: ["number", "null"], description: "Total square footage. Return null if not found." },
    lotSize: { type: ["string", "null"], description: "Lot size (e.g. '0.25 acres' or '10,890 sqft'). Return null if not found." },
    yearBuilt: { type: ["number", "null"], description: "Year the property was built. Return null if not found." },
    propertyType: { type: ["string", "null"], description: "Property type: 'Single Family', 'Condo', 'Townhouse', etc. Return null if not found." },
    status: { type: ["string", "null"], description: "Current status: 'For Sale', 'Pending', 'Sold', etc. Return null if not found." },
    daysOnZillow: { type: ["number", "null"], description: "Days on Zillow from the listing facts. Return null if not found." },
    mlsNumber: { type: ["string", "null"], description: "MLS listing number. Return null if not found." },
    zpid: { type: ["string", "null"], description: "Zillow property ID (numeric string). Return null if not found." },
    description: { type: ["string", "null"], description: "Full property description text. Return null if not found." },
  },
};

/**
 * Listing detail: features, financials, scores, photos (≤15 fields).
 * Scraped second to enrich the basic data.
 */
const LISTING_DETAIL_SCHEMA = {
  type: "object" as const,
  properties: {
    features: { type: "array" as const, items: { type: "string" }, description: "General features/highlights listed on the page. Return empty array if none." },
    interiorDetails: { type: "array" as const, items: { type: "string" }, description: "Interior details from the Facts & Features section. Return empty array if none." },
    exteriorDetails: { type: "array" as const, items: { type: "string" }, description: "Exterior details from the Facts & Features section. Return empty array if none." },
    parking: { type: ["string", "null"], description: "Parking info (e.g. '2-car garage'). Return null if not found." },
    heating: { type: ["string", "null"], description: "Heating system type. Return null if not found." },
    cooling: { type: ["string", "null"], description: "Cooling system type. Return null if not found." },
    appliances: { type: "array" as const, items: { type: "string" }, description: "List of included appliances. Return empty array if none." },
    flooring: { type: ["string", "null"], description: "Flooring types. Return null if not found." },
    hoaFee: { type: ["string", "null"], description: "HOA monthly fee as displayed. Return null if not found." },
    taxAssessedValue: { type: ["string", "null"], description: "Tax assessed value. Return null if not found." },
    annualTax: { type: ["string", "null"], description: "Annual property tax amount. Return null if not found." },
    photoUrls: { type: "array" as const, items: { type: "string" }, description: "All property photo URLs visible on the page. Extract ALL image URLs." },
    virtualTourUrl: { type: ["string", "null"], description: "Virtual tour / 3D tour URL if available. Return null if not found." },
    listingAgent: { type: ["string", "null"], description: "Listing agent's name. Return null if not found." },
    listingBrokerage: { type: ["string", "null"], description: "Listing brokerage name. Return null if not found." },
  },
};

/**
 * Listing detail: neighborhood, schools, scores (≤10 fields).
 * Optional third pass for neighborhood context.
 */
const LISTING_NEIGHBORHOOD_SCHEMA = {
  type: "object" as const,
  properties: {
    neighborhood: { type: ["string", "null"], description: "Neighborhood name. Return null if not found." },
    schoolDistrict: { type: ["string", "null"], description: "School district name. Return null if not found." },
    nearbySchools: {
      type: "array" as const,
      description: "Nearby schools with ratings. Return empty array if none found.",
      items: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "School name." },
          rating: { type: ["string", "null"], description: "Rating (e.g. '8/10'). Return null if not shown." },
          distance: { type: ["string", "null"], description: "Distance (e.g. '0.3 mi'). Return null if not shown." },
          grades: { type: ["string", "null"], description: "Grade range (e.g. 'K-5'). Return null if not shown." },
        },
      },
    },
    walkScore: { type: ["number", "null"], description: "Walk Score (0-100). Return null if not found." },
    transitScore: { type: ["number", "null"], description: "Transit Score (0-100). Return null if not found." },
  },
};

// ---------------------------------------------------------------------------
// Firecrawl v2 HTTP helpers
// ---------------------------------------------------------------------------

const FC_BASE = "https://api.firecrawl.dev/v2";

function requireFirecrawl(): string {
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

async function fcPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = requireFirecrawl();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150_000);

  try {
    const res = await fetch(`${FC_BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = (await res.json()) as Record<string, unknown>;

    if (!res.ok || payload.success === false) {
      const errMsg = typeof payload.error === "string" ? payload.error : `HTTP ${res.status}`;
      throw new Error(`Firecrawl ${path}: ${errMsg}`);
    }

    return (payload.data ?? payload) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

async function fcGet(path: string): Promise<Record<string, unknown>> {
  const key = requireFirecrawl();

  const res = await fetch(`${FC_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });

  const payload = (await res.json()) as Record<string, unknown>;
  if (!res.ok || payload.success === false) {
    const errMsg = typeof payload.error === "string" ? payload.error : `HTTP ${res.status}`;
    throw new Error(`Firecrawl GET ${path}: ${errMsg}`);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Profile scrape
// ---------------------------------------------------------------------------

export async function scrapeZillowProfile(profileUrl: string): Promise<ZillowProfileResult> {
  const url = validateZillowUrl(profileUrl);

  // Strategy 1: JSON extraction + markdown in one call
  try {
    log("Scraping profile (JSON+markdown)", url);
    const result = await fcPost("/scrape", {
      url,
      formats: [
        "markdown",
        {
          type: "json",
          schema: PROFILE_SCHEMA,
          prompt:
            "Extract the real estate agent's name, email, phone, brokerage, and ALL property listings (active/for-sale, sold, rentals) with their full Zillow URLs, addresses, prices, beds, baths, sqft. Do not skip any listings.",
        },
      ],
      timeout: 120000,
      maxAge: 3600000, // 1 hour cache — profiles change infrequently
    });

    const json = result.json as Record<string, unknown> | undefined;
    if (json && (json.activeListings || json.soldListings || json.agentName)) {
      const profile: ZillowProfileResult = {
        agentName: str(json.agentName),
        agentEmail: str(json.agentEmail),
        agentPhone: str(json.agentPhone),
        brokerageName: str(json.brokerageName),
        activeListings: normalizeListings(json.activeListings, "For Sale"),
        soldListings: normalizeListings(json.soldListings, "Sold"),
        rentals: normalizeListings(json.rentals, "For Rent"),
      };
      log("JSON extraction succeeded", {
        agent: profile.agentName,
        active: profile.activeListings.length,
        sold: profile.soldListings.length,
        rentals: profile.rentals.length,
      });
      return profile;
    }

    // JSON empty but got markdown — parse with regex
    const md = typeof result.markdown === "string" ? result.markdown : "";
    if (md) {
      log("JSON empty, parsing markdown with regex", { mdLength: md.length });
      const hints = parseZillowListingHints(md);
      if (hints.length > 0) {
        log("Regex found listings in markdown", { count: hints.length });
        return profileFromHints(hints);
      }
    }
  } catch (e) {
    log("JSON+markdown scrape failed", e instanceof Error ? e.message : e);
  }

  // Strategy 2: plain markdown (no LLM overhead)
  try {
    log("Falling back to markdown-only scrape", url);
    const result = await fcPost("/scrape", {
      url,
      formats: ["markdown"],
      timeout: 120000,
      maxAge: 3600000,
    });

    const md = typeof result.markdown === "string" ? result.markdown : "";
    const hints = parseZillowListingHints(md);
    if (hints.length > 0) {
      log("Markdown regex fallback found listings", { count: hints.length });
      return profileFromHints(hints);
    }
  } catch (e) {
    log("Markdown fallback failed", e instanceof Error ? e.message : e);
  }

  throw new Error(
    "Could not scrape Zillow profile. Both JSON extraction and markdown parsing returned no listings. " +
      "Try again later — Zillow pages are JS-heavy and may need multiple attempts."
  );
}

function profileFromHints(hints: ZillowParsedListing[]): ZillowProfileResult {
  return {
    agentName: null,
    agentEmail: null,
    agentPhone: null,
    brokerageName: null,
    activeListings: hints.map((h) => ({
      zpid: h.zpid,
      address: h.addressGuess,
      city: "",
      state: "",
      zip: "",
      beds: null,
      baths: null,
      sqft: null,
      price: "—",
      status: "For Sale",
      listingUrl: h.listingUrl,
      thumbnailUrl: null,
    })),
    soldListings: [],
    rentals: [],
  };
}

// ---------------------------------------------------------------------------
// Batch scrape listing details (concurrent)
// ---------------------------------------------------------------------------

export type BatchDetailResult = Map<string, ZillowListingDetail>;

/**
 * Scrape multiple listing detail pages concurrently using Firecrawl batch scrape.
 * Returns a Map keyed by listing URL.
 */
export async function batchScrapeListingDetails(
  listingUrls: string[]
): Promise<BatchDetailResult> {
  if (listingUrls.length === 0) return new Map();

  const urls = listingUrls.map(validateZillowUrl);
  const results: BatchDetailResult = new Map();

  log("Starting batch scrape for listing details", { count: urls.length });

  // Start the batch job — basic facts extraction
  const startPayload = await fcPost("/batch/scrape", {
    urls,
    formats: [
      {
        type: "json",
        schema: LISTING_BASIC_SCHEMA,
        prompt:
          "Extract property facts: address, city, state, zip, price, beds, baths, sqft, lot size, year built, property type, status, days on Zillow, MLS number, zpid, and full description.",
      },
    ],
    timeout: 120000,
    maxAge: 86400000, // 1 day cache — listing basic facts rarely change
  }) as Record<string, unknown>;

  const jobId = startPayload.id as string | undefined;
  if (!jobId) {
    log("Batch scrape returned no job ID, falling back to sequential");
    return sequentialFallback(urls);
  }

  log("Batch job started", { jobId });

  // Poll until complete
  const basicData = await pollBatchJob(jobId);
  log("Batch basic facts complete", { pages: basicData.length });

  // Map URL → basic data
  const basicByUrl = new Map<string, Record<string, unknown>>();
  for (const page of basicData) {
    const meta = page.metadata as Record<string, unknown> | undefined;
    const sourceUrl = str(meta?.sourceURL) ?? str(meta?.url) ?? "";
    const json = page.json as Record<string, unknown> | undefined;
    if (sourceUrl && json) basicByUrl.set(sourceUrl, json);
  }

  // Second pass: features/financials/photos
  let detailByUrl = new Map<string, Record<string, unknown>>();
  try {
    const detailStart = await fcPost("/batch/scrape", {
      urls,
      formats: [
        {
          type: "json",
          schema: LISTING_DETAIL_SCHEMA,
          prompt:
            "Extract all interior and exterior features, parking, HVAC, appliances, flooring, HOA fee, tax info, ALL photo URLs, virtual tour URL, listing agent, and brokerage name.",
        },
      ],
      timeout: 120000,
      maxAge: 86400000,
    }) as Record<string, unknown>;

    const detailJobId = detailStart.id as string | undefined;
    if (detailJobId) {
      const detailData = await pollBatchJob(detailJobId);
      for (const page of detailData) {
        const meta = page.metadata as Record<string, unknown> | undefined;
        const sourceUrl = str(meta?.sourceURL) ?? str(meta?.url) ?? "";
        const json = page.json as Record<string, unknown> | undefined;
        if (sourceUrl && json) detailByUrl.set(sourceUrl, json);
      }
      log("Batch detail pass complete", { pages: detailByUrl.size });
    }
  } catch (e) {
    log("Detail batch failed (non-fatal)", e instanceof Error ? e.message : e);
  }

  // Third pass: neighborhood/schools (optional, skip on error)
  let neighborhoodByUrl = new Map<string, Record<string, unknown>>();
  try {
    const nhStart = await fcPost("/batch/scrape", {
      urls,
      formats: [
        {
          type: "json",
          schema: LISTING_NEIGHBORHOOD_SCHEMA,
          prompt:
            "Extract neighborhood name, school district, nearby schools with ratings and distances, walk score, and transit score.",
        },
      ],
      timeout: 120000,
      maxAge: 86400000,
    }) as Record<string, unknown>;

    const nhJobId = nhStart.id as string | undefined;
    if (nhJobId) {
      const nhData = await pollBatchJob(nhJobId);
      for (const page of nhData) {
        const meta = page.metadata as Record<string, unknown> | undefined;
        const sourceUrl = str(meta?.sourceURL) ?? str(meta?.url) ?? "";
        const json = page.json as Record<string, unknown> | undefined;
        if (sourceUrl && json) neighborhoodByUrl.set(sourceUrl, json);
      }
      log("Batch neighborhood pass complete", { pages: neighborhoodByUrl.size });
    }
  } catch (e) {
    log("Neighborhood batch failed (non-fatal)", e instanceof Error ? e.message : e);
  }

  // Merge all passes
  for (const url of urls) {
    const basic = basicByUrl.get(url) ?? {};
    const detail = detailByUrl.get(url) ?? {};
    const nh = neighborhoodByUrl.get(url) ?? {};
    results.set(url, mergeToDetail(basic, detail, nh));
  }

  return results;
}

async function pollBatchJob(
  jobId: string,
  maxWaitMs = 300_000
): Promise<Record<string, unknown>[]> {
  const start = Date.now();
  let delay = 3000;

  while (Date.now() - start < maxWaitMs) {
    await sleep(delay);
    const status = await fcGet(`/batch/scrape/${jobId}`);
    const state = status.status as string;

    if (state === "completed") {
      return (status.data ?? []) as Record<string, unknown>[];
    }
    if (state === "failed") {
      throw new Error(`Batch job ${jobId} failed: ${status.error ?? "unknown"}`);
    }

    log("Batch polling", { jobId, status: state, elapsed: Date.now() - start });
    delay = Math.min(delay * 1.5, 15000);
  }

  throw new Error(`Batch job ${jobId} timed out after ${maxWaitMs}ms`);
}

async function sequentialFallback(urls: string[]): Promise<BatchDetailResult> {
  const results: BatchDetailResult = new Map();
  for (const url of urls) {
    try {
      const detail = await scrapeZillowListingDetail(url);
      results.set(url, detail);
    } catch (e) {
      log("Sequential detail scrape failed", { url, error: e instanceof Error ? e.message : e });
    }
  }
  return results;
}

function mergeToDetail(
  basic: Record<string, unknown>,
  detail: Record<string, unknown>,
  neighborhood: Record<string, unknown>
): ZillowListingDetail {
  return {
    address: str(basic.address) ?? "",
    city: str(basic.city) ?? "",
    state: str(basic.state) ?? "",
    zip: str(basic.zip) ?? "",
    price: str(basic.price) ?? "—",
    beds: num(basic.beds),
    baths: num(basic.baths),
    sqft: num(basic.sqft),
    lotSize: str(basic.lotSize),
    yearBuilt: num(basic.yearBuilt),
    propertyType: str(basic.propertyType),
    status: str(basic.status),
    daysOnZillow: num(basic.daysOnZillow),
    mlsNumber: str(basic.mlsNumber),
    zpid: str(basic.zpid),
    description: str(basic.description),
    features: strArr(detail.features),
    interiorDetails: strArr(detail.interiorDetails),
    exteriorDetails: strArr(detail.exteriorDetails),
    parking: str(detail.parking),
    heating: str(detail.heating),
    cooling: str(detail.cooling),
    appliances: strArr(detail.appliances),
    flooring: str(detail.flooring),
    hoaFee: str(detail.hoaFee),
    taxAssessedValue: str(detail.taxAssessedValue),
    annualTax: str(detail.annualTax),
    schoolDistrict: str(neighborhood.schoolDistrict),
    nearbySchools: Array.isArray(neighborhood.nearbySchools)
      ? (neighborhood.nearbySchools as Record<string, unknown>[]).map((s) => ({
          name: str(s.name) ?? "",
          rating: str(s.rating) ?? "",
          distance: str(s.distance) ?? "",
          grades: str(s.grades) ?? "",
        }))
      : [],
    photoUrls: strArr(detail.photoUrls),
    virtualTourUrl: str(detail.virtualTourUrl),
    listingAgent: str(detail.listingAgent),
    listingBrokerage: str(detail.listingBrokerage),
    neighborhood: str(neighborhood.neighborhood),
    walkScore: num(neighborhood.walkScore),
    transitScore: num(neighborhood.transitScore),
  };
}

// ---------------------------------------------------------------------------
// Single listing detail scrape (used by agent tool for ad-hoc lookups)
// ---------------------------------------------------------------------------

export async function scrapeZillowListingDetail(listingUrl: string): Promise<ZillowListingDetail> {
  const url = validateZillowUrl(listingUrl);

  log("Scraping single listing detail", url);

  // Two-pass: basic + details in parallel
  const [basicResult, detailResult] = await Promise.all([
    fcPost("/scrape", {
      url,
      formats: [
        {
          type: "json",
          schema: LISTING_BASIC_SCHEMA,
          prompt:
            "Extract property facts: address, city, state, zip, price, beds, baths, sqft, lot size, year built, property type, status, days on Zillow, MLS number, zpid, and full description.",
        },
      ],
      timeout: 120000,
      maxAge: 86400000,
    }),
    fcPost("/scrape", {
      url,
      formats: [
        {
          type: "json",
          schema: LISTING_DETAIL_SCHEMA,
          prompt:
            "Extract all interior and exterior features, parking, HVAC, appliances, flooring, HOA fee, tax info, ALL photo URLs, virtual tour URL, listing agent, and brokerage name.",
        },
      ],
      timeout: 120000,
      maxAge: 86400000,
    }),
  ]);

  // Third pass: neighborhood (optional, don't block on failure)
  let nhData: Record<string, unknown> = {};
  try {
    const nhResult = await fcPost("/scrape", {
      url,
      formats: [
        {
          type: "json",
          schema: LISTING_NEIGHBORHOOD_SCHEMA,
          prompt:
            "Extract neighborhood name, school district, nearby schools with ratings, walk score, and transit score.",
        },
      ],
      timeout: 120000,
      maxAge: 86400000,
    });
    nhData = (nhResult.json ?? {}) as Record<string, unknown>;
  } catch {
    log("Neighborhood extraction failed (non-fatal)", url);
  }

  const basic = (basicResult.json ?? {}) as Record<string, unknown>;
  const detail = (detailResult.json ?? {}) as Record<string, unknown>;

  log("Single listing scrape complete", { address: str(basic.address), price: str(basic.price) });

  return mergeToDetail(basic, detail, nhData);
}

// ---------------------------------------------------------------------------
// Legacy HTML/markdown parsing (regex fallback)
// ---------------------------------------------------------------------------

export function parseZillowListingHints(content: string): ZillowParsedListing[] {
  const byZpid = new Map<string, ZillowParsedListing>();

  const hrefRe =
    /(?:href="|]\()?(https?:\/\/www\.zillow\.com\/homedetails\/[^\s")\]]+|\/homedetails\/[^\s")\]]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(content)) !== null) {
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
  while ((m = looseRe.exec(content)) !== null) {
    const zpid = m[1];
    if (byZpid.has(zpid)) continue;
    const full = m[0];
    byZpid.set(zpid, {
      zpid,
      listingUrl: `https://www.zillow.com${full}`,
      addressGuess: slugToGuess(full.replace(/^\/homedetails\//i, "")),
    });
  }

  const zpidJsonRe = /"zpid"\s*:\s*"?(\d{6,})"?/g;
  while ((m = zpidJsonRe.exec(content)) !== null) {
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
      const result = await fcPost("/scrape", {
        url,
        formats: ["html"],
        timeout: 120000,
      });
      const html = typeof result.html === "string" ? result.html : "";
      if (html) return html;
    } catch (e) {
      log("Firecrawl HTML fetch failed", e instanceof Error ? e.message : e);
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
    throw new Error("Zillow denied access (HTTP 403/401). Set FIRECRAWL_API_KEY for proxy-based scraping.");
  }
  if (!res.ok) throw new Error(`Zillow HTTP ${res.status}`);
  return res.text();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function normalizeListings(raw: unknown, defaultStatus: string): ZillowProfileListing[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .filter((item) => str(item.zpid) || str(item.listingUrl) || str(item.address))
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function log(label: string, data?: unknown) {
  const ts = new Date().toISOString();
  if (data !== undefined) {
    console.log(`[zillow ${ts}] ${label}`, typeof data === "string" ? data : JSON.stringify(data));
  } else {
    console.log(`[zillow ${ts}] ${label}`);
  }
}
