import { generateText, tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./types";
import { resolveLanguageModel } from "@/lib/ai-chat";

export function followupTools(ctx: ToolContext) {
  return {
    followup_draft_email: tool({
      description: "Generate a follow-up email draft for a contact/lead.",
      parameters: z.object({
        contactName: z.string().describe("Name of the person to follow up with."),
        context: z.string().describe("Context: what happened, what property, what to follow up about."),
        tone: z.string().optional().describe("Override tone. Defaults to brokerage tone."),
      }),
      execute: async ({ contactName, context, tone }) => {
        const model = resolveLanguageModel();
        if (!model) return { error: "No AI provider configured." };
        const result = await generateText({
          model,
          system: `You are a real estate agent writing follow-up emails. Tone: ${tone ?? ctx.defaultTone}. Keep it concise, professional, and personal. Include a subject line on the first line prefixed with "Subject: ".`,
          prompt: `Write a follow-up email to ${contactName}.\n\nContext: ${context}`,
        });
        return { email: result.text };
      },
    }),

    followup_draft_text: tool({
      description: "Generate a short SMS/text message follow-up for a contact.",
      parameters: z.object({
        contactName: z.string().describe("Name of the person."),
        context: z.string().describe("What to follow up about."),
      }),
      execute: async ({ contactName, context }) => {
        const model = resolveLanguageModel();
        if (!model) return { error: "No AI provider configured." };
        const result = await generateText({
          model,
          system: `You are a real estate agent writing a brief text message. Tone: ${ctx.defaultTone}. Keep under 160 characters if possible, max 320.`,
          prompt: `Write a text message follow-up to ${contactName}.\n\nContext: ${context}`,
        });
        return { text: result.text };
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
        return { created: true, eventId: res.data.id, htmlLink: res.data.htmlLink };
      },
    }),
  };
}
