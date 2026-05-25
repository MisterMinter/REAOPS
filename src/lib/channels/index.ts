import { ChannelKind, type PrismaClient } from "@prisma/client";
import { decryptSecret } from "@/lib/crypto";
import { sendEmail } from "@/lib/gmail-send";

export type ChannelSendInput = {
  prisma: PrismaClient;
  tenantId: string;
  channel: ChannelKind;
  recipient: string;
  subject?: string | null;
  body: string;
  accessToken?: string | null;
};

export type ChannelSendResult = {
  ok: boolean;
  externalId?: string | null;
  error?: string;
};

function htmlBody(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function blueBubblesChatGuid(recipient: string): string {
  if (recipient.startsWith("iMessage;")) return recipient;
  const clean = recipient.trim();
  return `iMessage;+;${clean}`;
}

export async function sendChannelMessage(
  input: ChannelSendInput
): Promise<ChannelSendResult> {
  if (!input.recipient.trim()) {
    return { ok: false, error: "Missing recipient." };
  }

  if (input.channel === ChannelKind.GMAIL) {
    if (!input.accessToken) {
      return { ok: false, error: "No Google access token available for Gmail." };
    }
    try {
      const result = await sendEmail({
        accessToken: input.accessToken,
        to: input.recipient,
        subject: input.subject || "Follow-up",
        bodyHtml: htmlBody(input.body),
      });
      return { ok: true, externalId: result.messageId };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Gmail send failed.",
      };
    }
  }

  if (input.channel === ChannelKind.TELEGRAM) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return { ok: false, error: "TELEGRAM_BOT_TOKEN is not configured." };
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: input.recipient,
          text: input.body,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        return {
          ok: false,
          error: typeof data.description === "string" ? data.description : res.statusText,
        };
      }
      const result = data.result as { message_id?: number } | undefined;
      return { ok: true, externalId: result?.message_id ? String(result.message_id) : null };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Telegram send failed.",
      };
    }
  }

  if (input.channel === ChannelKind.BLUEBUBBLES) {
    const account = await input.prisma.channelAccount.findFirst({
      where: { tenantId: input.tenantId, kind: ChannelKind.BLUEBUBBLES },
      orderBy: { updatedAt: "desc" },
    });
    const { baseUrl, password } = blueBubblesConfig(account);

    if (!account || !baseUrl) {
      return { ok: false, error: "BlueBubbles channel is not configured." };
    }

    const url = new URL(`${baseUrl}/api/v1/message/text`);
    if (password) url.searchParams.set("password", password);

    try {
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatGuid: blueBubblesChatGuid(input.recipient),
          tempGuid: crypto.randomUUID(),
          message: input.body,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        return {
          ok: false,
          error:
            typeof data.error === "string"
              ? data.error
              : typeof data.message === "string"
                ? data.message
                : res.statusText,
        };
      }
      return {
        ok: true,
        externalId:
          typeof data.guid === "string"
            ? data.guid
            : typeof data.messageGuid === "string"
              ? data.messageGuid
              : null,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "BlueBubbles send failed.",
      };
    }
  }

  return {
    ok: false,
    error: `${input.channel} is reserved for a future channel adapter.`,
  };
}

export async function checkBlueBubblesHealth(
  prisma: PrismaClient,
  tenantId: string
): Promise<{ ok: boolean; error?: string }> {
  const account = await prisma.channelAccount.findFirst({
    where: { tenantId, kind: ChannelKind.BLUEBUBBLES },
    orderBy: { updatedAt: "desc" },
  });
  const { baseUrl, password } = blueBubblesConfig(account);
  if (!account || !baseUrl) return { ok: false, error: "BlueBubbles is not configured." };

  const url = new URL(`${baseUrl}/api/v1/ping`);
  if (password) url.searchParams.set("password", password);

  try {
    const res = await fetch(url.toString(), { method: "GET" });
    const ok = res.ok;
    await prisma.channelAccount.update({
      where: { id: account.id },
      data: {
        status: ok ? "healthy" : "degraded",
        lastHealthCheckAt: new Date(),
        lastError: ok ? null : res.statusText,
      },
    });
    return ok ? { ok: true } : { ok: false, error: res.statusText };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Health check failed.";
    await prisma.channelAccount.update({
      where: { id: account.id },
      data: { status: "degraded", lastHealthCheckAt: new Date(), lastError: error },
    });
    return { ok: false, error };
  }
}

function blueBubblesConfig(
  account: { config: unknown; secretRef: string | null } | null
): { baseUrl: string; password: string } {
  const config = (account?.config ?? {}) as Record<string, unknown>;
  const baseUrl = typeof config.baseUrl === "string" ? config.baseUrl.replace(/\/$/, "") : "";
  let password = "";
  if (account?.secretRef) {
    try {
      password = decryptSecret(account.secretRef);
    } catch {
      password = "";
    }
  }
  if (!password) {
    password =
      typeof config.password === "string"
        ? config.password
        : typeof config.apiPassword === "string"
          ? config.apiPassword
          : "";
  }
  return { baseUrl, password };
}
