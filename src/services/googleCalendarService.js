import { google } from "googleapis";
import fs          from "fs";
import { logger }  from "../utils/logger.js";

let calendar = null;

export function initCalendar() {
  const keyPath = process.env.GOOGLE_KEY_PATH || "./credentials.json";
  if (!fs.existsSync(keyPath)) {
    logger.warn("credentials.json not found — Calendar disabled");
    return;
  }
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes:  ["https://www.googleapis.com/auth/calendar"],
    });
    calendar = google.calendar({ version: "v3", auth });
    logger.info("Google Calendar ready ✅");
  } catch (e) {
    logger.error("Calendar init failed:", e.message);
  }
}

export function isCalendarReady() {
  return !!calendar && !!process.env.GOOGLE_CALENDAR_ID;
}

export async function createCalendarEvent(title, subject, dueDate) {
  if (!isCalendarReady() || !dueDate) return null;
  try {
    const r = await calendar.events.insert({
      calendarId:  process.env.GOOGLE_CALENDAR_ID,
      requestBody: {
        summary:     `📚 [${subject}] ${title}`,
        description: `การบ้านวิชา ${subject}`,
        start:   { date: dueDate },
        end:     { date: dueDate },
        colorId: "6",
      },
    });
    logger.info(`Calendar event created: ${r.data.id}`);
    return r.data.id;
  } catch (e) {
    logger.error("createCalendarEvent:", e.message);
    return null;
  }
}

export async function deleteCalendarEvent(eventId) {
  if (!isCalendarReady() || !eventId) return;
  try {
    await calendar.events.delete({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      eventId,
    });
    logger.info(`Calendar event deleted: ${eventId}`);
  } catch (e) {
    logger.error("deleteCalendarEvent:", e.message);
  }
}

export async function listUpcomingEvents(days = 7) {
  if (!isCalendarReady()) return null;
  try {
    const today  = new Date(); today.setHours(0,0,0,0);
    const maxEnd = new Date(today); maxEnd.setDate(today.getDate() + days);
    const res    = await calendar.events.list({
      calendarId:   process.env.GOOGLE_CALENDAR_ID,
      timeMin:      today.toISOString(),
      timeMax:      maxEnd.toISOString(),
      singleEvents: true,
      orderBy:      "startTime",
    });
    return res.data.items || [];
  } catch (e) {
    logger.error("listUpcomingEvents:", e.message);
    return null;
  }
}