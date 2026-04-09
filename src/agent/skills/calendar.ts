import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./types";
import { google } from "googleapis";

function getCalendarClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth });
}

export function calendarTools(ctx: ToolContext) {
  function requireToken() {
    if (!ctx.accessToken) throw new Error("No Google token. User needs to sign in with Google.");
    return ctx.accessToken;
  }

  return {
    calendar_list_events: tool({
      description: "List upcoming Google Calendar events. Useful for checking showings, open houses, and meetings.",
      parameters: z.object({
        daysAhead: z.number().optional().describe("How many days ahead to look. Default 7."),
        query: z.string().optional().describe("Optional search text to filter events."),
      }),
      execute: async ({ daysAhead, query }) => {
        const token = requireToken();
        const cal = getCalendarClient(token);
        const now = new Date();
        const until = new Date(now.getTime() + (daysAhead ?? 7) * 86400000);
        const res = await cal.events.list({
          calendarId: "primary",
          timeMin: now.toISOString(),
          timeMax: until.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 25,
          q: query ?? undefined,
        });
        const events = (res.data.items ?? []).map((e) => ({
          id: e.id,
          summary: e.summary,
          start: e.start?.dateTime ?? e.start?.date,
          end: e.end?.dateTime ?? e.end?.date,
          location: e.location,
          attendees: e.attendees?.map((a) => ({ email: a.email, name: a.displayName, status: a.responseStatus })),
          htmlLink: e.htmlLink,
        }));
        return { count: events.length, events };
      },
    }),

    calendar_create_event: tool({
      description: "Create a Google Calendar event (showing, open house, meeting, reminder).",
      parameters: z.object({
        title: z.string().describe("Event title."),
        startDateTime: z.string().describe("ISO 8601 start datetime (e.g. 2026-04-15T14:00:00-04:00)."),
        endDateTime: z.string().optional().describe("ISO 8601 end datetime. Defaults to 1 hour after start."),
        location: z.string().optional().describe("Address or location."),
        description: z.string().optional().describe("Event description/notes."),
        attendeeEmails: z.array(z.string()).optional().describe("Email addresses of attendees."),
      }),
      execute: async ({ title, startDateTime, endDateTime, location, description, attendeeEmails }) => {
        const token = requireToken();
        const cal = getCalendarClient(token);
        const start = new Date(startDateTime);
        const end = endDateTime
          ? new Date(endDateTime)
          : new Date(start.getTime() + 3600000);
        const res = await cal.events.insert({
          calendarId: "primary",
          requestBody: {
            summary: title,
            location: location ?? undefined,
            description: description ?? undefined,
            start: { dateTime: start.toISOString() },
            end: { dateTime: end.toISOString() },
            attendees: attendeeEmails?.map((email) => ({ email })),
          },
        });
        return { created: true, eventId: res.data.id, htmlLink: res.data.htmlLink };
      },
    }),

    calendar_add_attendee: tool({
      description: "Add an attendee to an existing Google Calendar event.",
      parameters: z.object({
        eventId: z.string().describe("Calendar event ID."),
        email: z.string().describe("Email of the new attendee."),
        name: z.string().optional().describe("Display name of the attendee."),
      }),
      execute: async ({ eventId, email, name }) => {
        const token = requireToken();
        const cal = getCalendarClient(token);
        const existing = await cal.events.get({ calendarId: "primary", eventId });
        const attendees = existing.data.attendees ?? [];
        attendees.push({ email, displayName: name });
        await cal.events.patch({
          calendarId: "primary",
          eventId,
          requestBody: { attendees },
        });
        return { added: true, email, eventId };
      },
    }),
  };
}
