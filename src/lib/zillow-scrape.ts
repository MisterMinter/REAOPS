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

export async function fetchZillowProfileHtml(profileUrl: string): Promise<string> {
  const url = profileUrl.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error("URL must start with http(s)://");
  }
  const u = new URL(url);
  if (!u.hostname.endsWith("zillow.com")) {
    throw new Error("Only zillow.com URLs are supported");
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; REAgentOS/1.0; +https://reaops.com) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    cache: "no-store",
  });

  if (res.status === 403 || res.status === 401) {
    throw new Error(
      "Zillow denied access (HTTP 403/401). Their edge often blocks cloud servers (e.g. Railway). Use Drive/HubSpot for listings, or add listings manually until a sanctioned feed exists."
    );
  }
  if (!res.ok) {
    throw new Error(`Zillow HTTP ${res.status}`);
  }

  return res.text();
}
