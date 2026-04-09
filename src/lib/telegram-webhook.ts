/**
 * Register (or update) the Telegram webhook for the bot.
 * Safe to call repeatedly — Telegram is idempotent for setWebhook.
 *
 * Call from a setup script, health endpoint, or the app's
 * instrumentation hook after deploy.
 */
export async function registerTelegramWebhook(
  appUrl?: string
): Promise<{ ok: boolean; description?: string }> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return { ok: false, description: "TELEGRAM_BOT_TOKEN not set" };

  const base = appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.RAILWAY_PUBLIC_DOMAIN;
  if (!base) return { ok: false, description: "No public app URL available (set NEXT_PUBLIC_APP_URL)" };

  const origin = base.startsWith("http") ? base : `https://${base}`;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const webhookUrl = `${origin}/api/agent/telegram${secret ? `?secret=${secret}` : ""}`;

  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ["message"],
    }),
  });

  const json = (await res.json()) as { ok: boolean; description?: string };
  console.log(`[telegram] setWebhook => ${json.ok ? "OK" : json.description}`);
  return json;
}
