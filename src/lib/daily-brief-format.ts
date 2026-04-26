import type { DailyBriefData } from "./daily-brief";

const MAX_TG = 4096;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function section(emoji: string, title: string): string {
  return `${emoji} <b>${esc(title)}</b>`;
}

function bullet(text: string): string {
  return ` • ${text}`;
}

function buildGreeting(data: DailyBriefData, userName: string): string {
  const hour = new Date().getHours();
  let greeting = "GOOD MORNING";
  if (hour >= 12 && hour < 17) greeting = "GOOD AFTERNOON";
  else if (hour >= 17) greeting = "GOOD EVENING";

  const lines = [
    `<b>☀️ ${greeting} ${esc(userName.toUpperCase())}</b>`,
    esc(data.date),
    "",
  ];
  return lines.join("\n");
}

function buildListingsSection(data: DailyBriefData): string {
  const lines = [section("🏠", "ACTIVE LISTINGS")];

  const stats = [
    `Active: <b>${data.activeCount}</b>`,
    `Pending: <b>${data.pendingCount}</b>`,
    `Closed MTD: <b>${data.closedMtdCount}</b>`,
  ];
  lines.push(stats.join("  |  "));

  if (data.avgDom != null) {
    const arrow = data.avgDom > data.domTarget ? "⚠️" : "✅";
    lines.push(
      `Avg DOM: <b>${data.avgDom} days</b> (target ${data.domTarget}↓) ${arrow}`
    );
  }

  for (const h of data.listingHighlights) {
    const flag = h.daysOnMarket != null && h.daysOnMarket > 30 ? " ⚠️" : "";
    lines.push(bullet(`${esc(h.address)} — ${esc(h.note)}${flag}`));
  }

  if (data.listingHighlights.length === 0 && data.activeCount > 0) {
    lines.push(bullet("All listings within target DOM range ✅"));
  }

  return lines.join("\n");
}

function buildShowingsSection(data: DailyBriefData): string {
  const lines = [section("📅", "TODAY'S SHOWINGS")];

  if (data.calendarError) {
    lines.push(`<i>${esc(data.calendarError)}</i>`);
    return lines.join("\n");
  }

  if (data.showings.length === 0) {
    lines.push("No showings scheduled today.");
    return lines.join("\n");
  }

  for (const s of data.showings) {
    let line = `<b>${esc(s.time)}</b> — ${esc(s.summary)}`;
    if (s.attendees.length > 0) {
      line += ` (${esc(s.attendees.join(", "))})`;
    }
    lines.push(line);
  }

  lines.push("");
  lines.push("<i>↻ Follow-up sequences will auto-trigger after each</i>");

  return lines.join("\n");
}

function buildFollowUpSection(data: DailyBriefData): string {
  const lines = [section("📬", "FOLLOW-UP STATUS")];

  lines.push(`Contacts in CRM: <b>${data.contactCount}</b>`);
  lines.push(`Contacted last 7 days: <b>${data.recentContactCount}</b>`);

  if (data.contactCount > 0) {
    const rate = Math.round((data.recentContactCount / data.contactCount) * 100);
    const filled = Math.round(rate / 10);
    const bar = "█".repeat(filled) + "░".repeat(10 - filled);
    lines.push(`${bar} ${rate}% recent contact rate`);
  }

  return lines.join("\n");
}

function buildMarketingSection(data: DailyBriefData): string {
  const lines = [section("📦", "MARKETING QUEUE")];

  if (data.marketingItems.length === 0) {
    lines.push("No listings with Drive folders to check.");
    return lines.join("\n");
  }

  const done = data.marketingItems.filter((m) => m.status === "done");
  const pending = data.marketingItems.filter((m) => m.status !== "done");

  for (const m of done) {
    lines.push(`✅ ${esc(m.address)} — flyer generated`);
  }
  for (const m of pending) {
    lines.push(`⏳ ${esc(m.address)} — awaiting flyer`);
  }

  return lines.join("\n");
}

function buildComplianceSection(data: DailyBriefData): string {
  const lines = [section("📋", "COMPLIANCE")];
  lines.push(`Standard: <b>${esc(data.complianceStandard)}</b>`);
  lines.push("<i>Document tracking coming soon.</i>");
  return lines.join("\n");
}

function buildRecommendationSection(data: DailyBriefData): string {
  if (!data.recommendation) return "";

  const lines = [
    section("💡", "MORT RECOMMENDS"),
    "",
    `<i>"${esc(data.recommendation)}"</i>`,
  ];
  return lines.join("\n");
}

/**
 * Render the full daily brief as Telegram HTML messages.
 * Returns an array of strings, each under the 4096-char Telegram limit.
 */
export function formatBriefForTelegram(
  data: DailyBriefData,
  userName: string
): string[] {
  const sections = [
    buildGreeting(data, userName),
    buildListingsSection(data),
    buildShowingsSection(data),
    buildFollowUpSection(data),
    buildMarketingSection(data),
    buildComplianceSection(data),
    buildRecommendationSection(data),
  ].filter(Boolean);

  const full = sections.join("\n\n");

  if (full.length <= MAX_TG) return [full];

  // Split into multiple messages, keeping sections intact
  const messages: string[] = [];
  let current = "";
  for (const sec of sections) {
    const candidate = current ? `${current}\n\n${sec}` : sec;
    if (candidate.length > MAX_TG) {
      if (current) messages.push(current);
      // If a single section exceeds the limit, hard-truncate it
      if (sec.length > MAX_TG) {
        messages.push(sec.slice(0, MAX_TG - 3) + "...");
      } else {
        current = sec;
      }
    } else {
      current = candidate;
    }
  }
  if (current) messages.push(current);

  return messages;
}

/**
 * Render a plain-text version of the brief (for web chat or non-Telegram contexts).
 */
export function formatBriefPlainText(
  data: DailyBriefData,
  userName: string
): string {
  const hour = new Date().getHours();
  let greeting = "Good morning";
  if (hour >= 12 && hour < 17) greeting = "Good afternoon";
  else if (hour >= 17) greeting = "Good evening";

  const lines = [
    `${greeting} ${userName}!`,
    data.date,
    "",
    `🏠 ACTIVE LISTINGS`,
    `Active: ${data.activeCount} | Pending: ${data.pendingCount} | Closed MTD: ${data.closedMtdCount}`,
  ];

  if (data.avgDom != null) {
    lines.push(`Avg DOM: ${data.avgDom} days (target ${data.domTarget})`);
  }

  for (const h of data.listingHighlights) {
    lines.push(` • ${h.address} — ${h.note}`);
  }

  lines.push("");
  lines.push(`📅 TODAY'S SHOWINGS`);
  if (data.calendarError) {
    lines.push(data.calendarError);
  } else if (data.showings.length === 0) {
    lines.push("No showings scheduled today.");
  } else {
    for (const s of data.showings) {
      const att = s.attendees.length > 0 ? ` (${s.attendees.join(", ")})` : "";
      lines.push(`${s.time} — ${s.summary}${att}`);
    }
  }

  lines.push("");
  lines.push(`📬 FOLLOW-UP STATUS`);
  lines.push(`Contacts: ${data.contactCount} | Contacted last 7d: ${data.recentContactCount}`);

  lines.push("");
  lines.push(`📦 MARKETING QUEUE`);
  for (const m of data.marketingItems) {
    const icon = m.status === "done" ? "✅" : "⏳";
    lines.push(`${icon} ${m.address}`);
  }
  if (data.marketingItems.length === 0) {
    lines.push("No Drive-linked listings to check.");
  }

  if (data.recommendation) {
    lines.push("");
    lines.push(`💡 RECOMMENDATION`);
    lines.push(`"${data.recommendation}"`);
  }

  return lines.join("\n");
}
