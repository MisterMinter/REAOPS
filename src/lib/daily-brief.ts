import { prisma } from "@/lib/prisma";
import { google } from "googleapis";
import { generateText } from "ai";
import { resolveLanguageModel } from "@/lib/ai-chat";
import { getDriveClient } from "@/lib/drive";

export type ListingHighlight = {
  address: string;
  daysOnMarket: number | null;
  priceDisplay: string;
  note: string;
};

export type ShowingEvent = {
  time: string;
  summary: string;
  attendees: string[];
};

export type MarketingItem = {
  address: string;
  status: "done" | "in_progress" | "awaiting_photos";
};

export type DailyBriefData = {
  tenantName: string;
  date: string;

  activeCount: number;
  pendingCount: number;
  closedMtdCount: number;
  avgDom: number | null;
  domTarget: number;
  listingHighlights: ListingHighlight[];

  showings: ShowingEvent[];
  calendarError: string | null;

  contactCount: number;
  recentContactCount: number;

  marketingItems: MarketingItem[];

  complianceStandard: string;

  recommendation: string | null;
};

const ACTIVE_STATUSES = ["active", "for sale", "new", "coming soon"];
const PENDING_STATUSES = ["pending", "under contract", "contingent", "option pending"];
const CLOSED_STATUSES = ["closed", "sold", "off market"];

function normalizeStatusBucket(raw: string): "active" | "pending" | "closed" | "other" {
  const lower = raw.toLowerCase().trim();
  if (ACTIVE_STATUSES.some((s) => lower.includes(s))) return "active";
  if (PENDING_STATUSES.some((s) => lower.includes(s))) return "pending";
  if (CLOSED_STATUSES.some((s) => lower.includes(s))) return "closed";
  return "other";
}

export async function buildDailyBrief(
  tenantId: string,
  accessToken: string | null
): Promise<DailyBriefData> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      name: true,
      brokerageName: true,
      complianceStandard: true,
      driveConfig: { select: { rootFolderId: true } },
    },
  });

  const tenantName = tenant?.brokerageName ?? tenant?.name ?? "Brokerage";

  const listings = await prisma.cachedListing.findMany({
    where: { tenantId },
    select: {
      shortAddress: true,
      address: true,
      status: true,
      daysOnMarket: true,
      priceDisplay: true,
      driveFolderId: true,
      updatedAt: true,
    },
  });

  let activeCount = 0;
  let pendingCount = 0;
  let closedMtdCount = 0;
  const domValues: number[] = [];
  const highlights: ListingHighlight[] = [];

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  for (const l of listings) {
    const bucket = normalizeStatusBucket(l.status);
    if (bucket === "active") {
      activeCount++;
      if (l.daysOnMarket != null) domValues.push(l.daysOnMarket);
      if (l.daysOnMarket != null && l.daysOnMarket > 30) {
        highlights.push({
          address: l.shortAddress || l.address,
          daysOnMarket: l.daysOnMarket,
          priceDisplay: l.priceDisplay,
          note: `${l.daysOnMarket} days, price review`,
        });
      } else if (l.daysOnMarket != null && l.daysOnMarket <= 7) {
        highlights.push({
          address: l.shortAddress || l.address,
          daysOnMarket: l.daysOnMarket,
          priceDisplay: l.priceDisplay,
          note: `${l.daysOnMarket} days, new listing`,
        });
      }
    } else if (bucket === "pending") {
      pendingCount++;
    } else if (bucket === "closed") {
      if (l.updatedAt >= monthStart) closedMtdCount++;
    }
  }

  highlights.sort((a, b) => (b.daysOnMarket ?? 0) - (a.daysOnMarket ?? 0));
  const topHighlights = highlights.slice(0, 5);

  const avgDom =
    domValues.length > 0
      ? Math.round(domValues.reduce((a, b) => a + b, 0) / domValues.length)
      : null;

  // --- Calendar ---
  let showings: ShowingEvent[] = [];
  let calendarError: string | null = null;
  if (accessToken) {
    try {
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });
      const cal = google.calendar({ version: "v3", auth });
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now);
      todayEnd.setHours(23, 59, 59, 999);
      const res = await cal.events.list({
        calendarId: "primary",
        timeMin: todayStart.toISOString(),
        timeMax: todayEnd.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
      });
      const events = res.data.items ?? [];
      showings = events.map((e) => {
        const start = e.start?.dateTime ?? e.start?.date ?? "";
        let time = "";
        if (start) {
          try {
            const d = new Date(start);
            time = d.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            });
          } catch {
            time = start;
          }
        }
        const attendeeNames = (e.attendees ?? [])
          .filter((a) => !a.self)
          .map((a) => a.displayName || a.email || "")
          .filter(Boolean);
        return {
          time,
          summary: e.summary ?? "(no title)",
          attendees: attendeeNames,
        };
      });
    } catch {
      calendarError = "Could not load calendar.";
    }
  } else {
    calendarError = "No Google token available.";
  }

  // --- Contacts (follow-up stub) ---
  const contactCount = await prisma.cachedContact.count({ where: { tenantId } });
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentContactCount = await prisma.cachedContact.count({
    where: { tenantId, lastContactDate: { gte: sevenDaysAgo } },
  });

  // --- Marketing queue ---
  const marketingItems: MarketingItem[] = [];
  if (accessToken) {
    const listingsWithDrive = listings.filter((l) => l.driveFolderId);
    for (const l of listingsWithDrive.slice(0, 15)) {
      try {
        const drive = getDriveClient(accessToken);
        const res = await drive.files.list({
          q: `'${l.driveFolderId}' in parents and (name contains 'Flyer' or name contains 'flyer') and trashed = false`,
          fields: "files(id, name)",
          pageSize: 5,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        const flyerFiles = res.data.files ?? [];
        if (flyerFiles.length > 0) {
          marketingItems.push({
            address: l.shortAddress || l.address,
            status: "done",
          });
        } else {
          marketingItems.push({
            address: l.shortAddress || l.address,
            status: "awaiting_photos",
          });
        }
      } catch {
        marketingItems.push({
          address: l.shortAddress || l.address,
          status: "awaiting_photos",
        });
      }
    }
  }

  // --- AI recommendation ---
  let recommendation: string | null = null;
  const flagged = listings.filter(
    (l) =>
      normalizeStatusBucket(l.status) === "active" &&
      l.daysOnMarket != null &&
      l.daysOnMarket > 25
  );
  if (flagged.length > 0) {
    const model = resolveLanguageModel();
    if (model) {
      try {
        const block = flagged
          .map(
            (l) =>
              `${l.shortAddress || l.address} | ${l.daysOnMarket}d DOM | ${l.priceDisplay}`
          )
          .join("\n");
        const result = await generateText({
          model,
          system:
            "You are a real estate executive assistant. Write 1-2 concise, actionable recommendations about the flagged listings. Reference addresses and numbers. Keep it under 300 characters total.",
          prompt: `Today: ${now.toLocaleDateString()}\nFlagged listings (high DOM):\n${block}`,
        });
        recommendation = result.text;
      } catch (e) {
        console.error("[daily-brief] AI recommendation failed:", e);
      }
    }
  }

  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return {
    tenantName,
    date: dateStr,
    activeCount,
    pendingCount,
    closedMtdCount,
    avgDom,
    domTarget: 30,
    listingHighlights: topHighlights,
    showings,
    calendarError,
    contactCount,
    recentContactCount,
    marketingItems,
    complianceStandard: tenant?.complianceStandard ?? "ga_residential",
    recommendation,
  };
}
