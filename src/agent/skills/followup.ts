import { generateText, tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./types";
import { resolveLanguageModel } from "@/lib/ai-chat";
import { ChannelKind, MessageRisk } from "@prisma/client";
import {
  createFollowUpTask,
  draftMessage,
  scheduleReminder,
} from "@/lib/ops/workflows";

function actorFrom(ctx: ToolContext) {
  if (!ctx.tenantId) throw new Error("No brokerage assigned.");
  return { id: ctx.userId, tenantId: ctx.tenantId };
}

export function followupTools(ctx: ToolContext) {
  return {
    followup_create_task: tool({
      description:
        "Create a durable follow-up task visible in the Follow-Up Queue UI. Use this whenever the user asks to remember, queue, schedule, or manage outreach.",
      parameters: z.object({
        contactId: z.string().optional().describe("Optional Contact ID from the operations ledger."),
        title: z.string().describe("Short task title."),
        context: z.string().optional().describe("Why this follow-up matters and what should be said."),
        dueAt: z.string().optional().describe("Optional ISO 8601 due date/time."),
        source: z.string().optional().describe("Lead/workflow source, e.g. open_house, mass_nurture, manual."),
        risk: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
      }),
      execute: async ({ contactId, title, context, dueAt, source, risk }) => {
        const task = await createFollowUpTask({
          actor: actorFrom(ctx),
          contactId,
          title,
          context,
          source,
          dueAt: dueAt ? new Date(dueAt) : null,
          risk: risk as MessageRisk | undefined,
        });
        return {
          created: true,
          taskId: task.id,
          status: task.status,
          risk: task.risk,
          visibleIn: "/follow-up",
        };
      },
    }),

    followup_draft_message: tool({
      description:
        "Create a durable message draft for a follow-up task/contact. The draft appears in the Follow-Up Queue and follows brokerage approval/auto-send policy.",
      parameters: z.object({
        taskId: z.string().optional().describe("FollowUpTask ID, if one exists."),
        contactId: z.string().optional().describe("Contact ID, if drafting directly for a contact."),
        channel: z.enum(["GMAIL", "TELEGRAM", "BLUEBUBBLES", "WHATSAPP", "SMS"]).optional(),
        subject: z.string().optional(),
        body: z.string().optional(),
        context: z.string().optional(),
        recipient: z.string().optional(),
        autoSend: z.boolean().optional().describe("Whether to send immediately if policy permits."),
      }),
      execute: async (params) => {
        const draft = await draftMessage({
          actor: actorFrom(ctx),
          taskId: params.taskId,
          contactId: params.contactId,
          channel: (params.channel as ChannelKind | undefined) ?? ChannelKind.GMAIL,
          subject: params.subject,
          body: params.body,
          context: params.context,
          recipient: params.recipient,
          autoSend: params.autoSend,
        });
        return {
          draftId: draft.id,
          status: draft.status,
          channel: draft.channel,
          risk: draft.risk,
          requiresApproval: draft.requiresApproval,
          visibleIn: "/follow-up",
        };
      },
    }),

    followup_draft_email: tool({
      description:
        "Generate and persist a follow-up email draft for a contact/lead. Prefer followup_draft_message when a Contact or task ID is known.",
      parameters: z.object({
        contactName: z.string().describe("Name of the person to follow up with."),
        context: z.string().describe("Context: what happened, what property, what to follow up about."),
        tone: z.string().optional().describe("Override tone. Defaults to brokerage tone."),
        contactId: z.string().optional().describe("Optional Contact ID to attach the draft to."),
        taskId: z.string().optional().describe("Optional FollowUpTask ID to attach the draft to."),
        recipient: z.string().optional().describe("Recipient email override."),
      }),
      execute: async ({ contactName, context, tone, contactId, taskId, recipient }) => {
        const model = resolveLanguageModel();
        if (!model) return { error: "No AI provider configured." };
        const result = await generateText({
          model,
          system: `You are a real estate agent writing follow-up emails. Tone: ${tone ?? ctx.defaultTone}. Keep it concise, professional, and personal. Include a subject line on the first line prefixed with "Subject: ".`,
          prompt: `Write a follow-up email to ${contactName}.\n\nContext: ${context}`,
        });
        const text = result.text.trim();
        const subjectMatch = text.match(/^Subject:\s*(.+)$/im);
        const body = text.replace(/^Subject:\s*.+$/im, "").trim();
        const draft = await draftMessage({
          actor: actorFrom(ctx),
          taskId,
          contactId,
          channel: ChannelKind.GMAIL,
          subject: subjectMatch?.[1] ?? `Follow-up: ${contactName}`,
          body: body || text,
          context,
          recipient,
        });
        return {
          email: text,
          draftId: draft.id,
          status: draft.status,
          requiresApproval: draft.requiresApproval,
          visibleIn: "/follow-up",
        };
      },
    }),

    followup_draft_text: tool({
      description:
        "Generate and persist a short text/iMessage-style follow-up draft. Defaults to BlueBubbles because SMS/WhatsApp are future adapters.",
      parameters: z.object({
        contactName: z.string().describe("Name of the person."),
        context: z.string().describe("What to follow up about."),
        contactId: z.string().optional(),
        taskId: z.string().optional(),
        recipient: z.string().optional().describe("Phone/iMessage recipient override."),
      }),
      execute: async ({ contactName, context, contactId, taskId, recipient }) => {
        const model = resolveLanguageModel();
        if (!model) return { error: "No AI provider configured." };
        const result = await generateText({
          model,
          system: `You are a real estate agent writing a brief text message. Tone: ${ctx.defaultTone}. Keep under 160 characters if possible, max 320.`,
          prompt: `Write a text message follow-up to ${contactName}.\n\nContext: ${context}`,
        });
        const draft = await draftMessage({
          actor: actorFrom(ctx),
          taskId,
          contactId,
          channel: ChannelKind.BLUEBUBBLES,
          body: result.text,
          context,
          recipient,
        });
        return {
          text: result.text,
          draftId: draft.id,
          status: draft.status,
          requiresApproval: draft.requiresApproval,
          visibleIn: "/follow-up",
        };
      },
    }),

    followup_create_reminder: tool({
      description: "Create a calendar reminder for a follow-up action (calls the calendar_create_event tool internally).",
      parameters: z.object({
        contactName: z.string().describe("Who to follow up with."),
        action: z.string().describe("What to do (e.g. 'Call about offer', 'Send comps')."),
        dateTime: z.string().describe("ISO 8601 datetime for the reminder."),
      }),
      execute: async ({ contactName, action, dateTime }) => {
        const reminder = await scheduleReminder({
          actor: actorFrom(ctx),
          title: `Follow up: ${contactName} — ${action}`,
          context: `Reminder to ${action} for ${contactName}.`,
          dueAt: new Date(dateTime),
        });
        if (!ctx.accessToken) return { error: "No Google token for Calendar." };
        const { google } = await import("googleapis");
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: ctx.accessToken });
        const cal = google.calendar({ version: "v3", auth });
        const start = new Date(dateTime);
        const end = new Date(start.getTime() + 900000);
        const res = await cal.events.insert({
          calendarId: "primary",
          requestBody: {
            summary: `Follow up: ${contactName} — ${action}`,
            description: `Reminder to ${action} for ${contactName}.`,
            start: { dateTime: start.toISOString() },
            end: { dateTime: end.toISOString() },
            reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 15 }] },
          },
        });
        return {
          created: true,
          taskId: reminder.id,
          eventId: res.data.id,
          htmlLink: res.data.htmlLink,
          visibleIn: "/follow-up",
        };
      },
    }),
  };
}
