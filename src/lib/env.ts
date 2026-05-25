type EnvCheck = {
  name: string;
  ok: boolean;
  required: boolean;
  message?: string;
};

const REQUIRED_PRODUCTION = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "NEXTAUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "CRON_SECRET",
  "ZILLOW_SYNC_SECRET",
  "TELEGRAM_WEBHOOK_SECRET",
];

const OPTIONAL = [
  "GBRAIN_BASE_URL",
  "GBRAIN_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "HUBSPOT_CLIENT_ID",
  "HUBSPOT_CLIENT_SECRET",
  "BUFFER_ACCESS_TOKEN",
  "BUFFER_CLIENT_ID",
  "BUFFER_CLIENT_SECRET",
  "FIRECRAWL_API_KEY",
];

export function checkEnvironment() {
  const checks: EnvCheck[] = [];
  const production = process.env.NODE_ENV === "production";

  for (const name of REQUIRED_PRODUCTION) {
    const value = process.env[name]?.trim();
    const ok = !production || Boolean(value);
    checks.push({
      name,
      ok,
      required: production,
      message: ok ? undefined : `${name} must be set in production.`,
    });
  }

  checks.push({
    name: "AI_PROVIDER_KEY",
    ok: Boolean(
      process.env.GEMINI_API_KEY?.trim() ||
        process.env.ANTHROPIC_API_KEY?.trim() ||
        process.env.OPENAI_API_KEY?.trim()
    ),
    required: production,
    message: "At least one AI provider key is required for autonomous agent runs.",
  });

  const tokenKey = process.env.TOKEN_ENCRYPTION_KEY;
  checks.push({
    name: "TOKEN_ENCRYPTION_KEY_LENGTH",
    ok: !tokenKey || tokenKey.length >= 32,
    required: production,
    message: "TOKEN_ENCRYPTION_KEY must be at least 32 characters.",
  });

  for (const name of OPTIONAL) {
    checks.push({
      name,
      ok: Boolean(process.env[name]?.trim()),
      required: false,
      message: process.env[name]?.trim() ? undefined : `${name} is not configured.`,
    });
  }

  return {
    production,
    ok: checks.filter((c) => c.required).every((c) => c.ok),
    checks,
  };
}
