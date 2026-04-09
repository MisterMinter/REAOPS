/**
 * Best-effort extraction of listing zpids from public Zillow HTML.
 * Zillow changes markup often; this may return partial/empty results. Use subject to Zillow's terms.
 */

export type ZillowParsedListing = {
  zpid: string;
  listingUrl: string;
  /** Best-effort title from URL slug */
  addressGuess: string;
};

function homedetailsUrl(zpid: string, pathFragment: string) {
  const clean = pathFragment.replace(/^\/+/, "").replace(/\/$/, "");
  if (clean.includes("zillow.com")) {
    return clean.startsWith("http") ? clean : `https://${clean}`;
  }
  return `https://www.zillow.com/homedetails/${clean}`;
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

/**
 * Pull zpids from anchor hrefs and embedded JSON-ish blobs in the HTML.
 */
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
    const listingUrl = raw.startsWith("http") ? raw : `https://www.zillow.com${raw.startsWith("/") ? "" : "/"}${raw}`;
    const pathMatch = raw.match(/homedetails\/(.+)/i);
    const addressGuess = pathMatch ? slugToGuess(pathMatch[1]) : `Listing ${zpid}`;
    byZpid.set(zpid, { zpid, listingUrl, addressGuess });
  }

  const looseRe = /\/homedetails\/[a-zA-Z0-9\-_%/]+?(\d{6,})_zpid/gi;
  while ((m = looseRe.exec(html)) !== null) {
    const zpid = m[1];
    if (byZpid.has(zpid)) continue;
    const full = m[0];
    const listingUrl = homedetailsUrl(zpid, full);
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

async function fetchViaFirecrawl(url: string): Promise<string> {
  const FirecrawlApp = (await import("@mendable/firecrawl-js")).default;
  const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });

  const result = await app.scrapeUrl(url, {
    formats: ["html"],
    waitFor: 3000,
  });

  if (!result.success) {
    throw new Error(`Firecrawl scrape failed: ${result.error ?? "unknown"}`);
  }

  return result.html ?? "";
}

async function fetchDirect(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    },
    redirect: "follow",
    cache: "no-store",
  });

  if (res.status === 403 || res.status === 401) {
    throw new Error(
      "Zillow denied direct access (HTTP 403/401). Set FIRECRAWL_API_KEY to use proxy-based scraping, or add listings manually."
    );
  }
  if (!res.ok) {
    throw new Error(`Zillow HTTP ${res.status}`);
  }

  return res.text();
}

/**
 * Fetch Zillow profile HTML using Firecrawl (if configured) with fallback to direct fetch.
 * Firecrawl's proxy rotation and browser rendering has a much better chance of getting
 * through Zillow's anti-bot measures than a bare fetch from a datacenter IP.
 */
export async function fetchZillowProfileHtml(profileUrl: string): Promise<string> {
  const url = profileUrl.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error("URL must start with http(s)://");
  }
  const u = new URL(url);
  if (!u.hostname.endsWith("zillow.com")) {
    throw new Error("Only zillow.com URLs are supported");
  }

  if (process.env.FIRECRAWL_API_KEY?.trim()) {
    try {
      return await fetchViaFirecrawl(url);
    } catch (e) {
      console.warn("Firecrawl failed, falling back to direct fetch:", e instanceof Error ? e.message : e);
    }
  }

  return fetchDirect(url);
}
