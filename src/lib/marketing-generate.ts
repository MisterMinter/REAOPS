/** Must match generation instructions — used to split model output on the client. */
export const MARKETING_OUTPUT_DELIMITER = "===DELIMITER===";

export type ListingFacts = {
  address: string;
  city: string;
  state: string;
  zip: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  priceDisplay: string;
  features: string;
  status: string;
  daysOnMarket: number | null;
};

export function marketingSystemPrompt(defaultTone: string): string {
  return [
    "You are RE Agent OS, a real estate listing marketing copywriter.",
    `Brokerage tone: ${defaultTone}`,
    "Be accurate to the facts given. Avoid fair-housing violations and protected-class implications.",
    "Output must use the delimiter format exactly as requested — no markdown code fences around the whole response.",
  ].join(" ");
}

export function marketingUserPrompt(facts: ListingFacts, heroContext: string): string {
  const d = MARKETING_OUTPUT_DELIMITER;
  return `Write marketing for this listing.

Property facts:
- Address: ${facts.address}
- City / state / ZIP: ${facts.city}, ${facts.state} ${facts.zip}
- Beds: ${facts.beds ?? "—"}
- Baths: ${facts.baths ?? "—"}
- Sq ft: ${facts.sqft ?? "—"}
- Price: ${facts.priceDisplay}
- Status: ${facts.status}
- Days on market: ${facts.daysOnMarket ?? "—"}
- Features / notes: ${facts.features || "—"}

Hero photo: ${heroContext}

Respond with exactly four sections in this order. Separate sections with a single line containing only:
${d}
(no spaces before/after on that line)

Section 1 — MLS-style description (~200–280 words), professional and vivid.

${d}

Section 2 — One Instagram caption (under 2200 characters). Optional hashtags at the end.

${d}

Section 3 — Exactly three email subject lines, numbered 1. 2. 3. on separate lines.

${d}

Section 4 — One short line for a social graphic (under 120 characters).

Do not label sections "Section 1" inside the prose; start directly with the copy.`;
}

export type ParsedMarketingPack = {
  mls: string;
  instagram: string;
  emailSubjects: string;
  cardBlurb: string;
};

export function parseMarketingPackResponse(raw: string): ParsedMarketingPack {
  const parts = raw.split(MARKETING_OUTPUT_DELIMITER).map((p) => p.trim());
  return {
    mls: parts[0] ?? "",
    instagram: parts[1] ?? "",
    emailSubjects: parts[2] ?? "",
    cardBlurb: parts[3] ?? "",
  };
}
