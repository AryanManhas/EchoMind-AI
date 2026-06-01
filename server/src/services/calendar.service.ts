/**
 * CalendarService — Google Calendar OAuth 2.0 + Event CRUD for EchoMind.
 *
 * Responsibilities:
 * 1. Generate OAuth consent URL
 * 2. Exchange authorization code for tokens
 * 3. Auto-refresh expired access tokens
 * 4. Create / update / delete calendar events
 * 5. List upcoming events for context
 *
 * Token storage: CalendarIntegration model in Prisma (per-user, per-provider).
 */

import { google, calendar_v3 } from 'googleapis';
import { createLogger } from '../utils/logger.js';
import { env } from '../config/env.js';
import prisma from '../db/prisma.js';

const log = createLogger('calendar');

// ─── OAuth 2.0 Client ────────────────────────────────────────────

function createOAuth2Client() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw new Error(
      'Google Calendar not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env'
    );
  }
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
}

/** Scopes required for read/write calendar access */
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];

// ─── Types ────────────────────────────────────────────────────────

export interface CalendarEventInput {
  summary: string;
  description?: string;
  startTime: string;   // ISO 8601
  endTime?: string;     // ISO 8601 — defaults to startTime + 1h
  location?: string;
  isAllDay?: boolean;
  timeZone?: string;    // e.g., "Asia/Kolkata"
  recurrence?: string[];// e.g., ["RRULE:FREQ=WEEKLY;COUNT=10"]
  colorId?: string;
}

export interface CalendarEventResult {
  id: string;
  htmlLink: string;
  summary: string;
  start: string;
  end: string;
  status: string;
}

// ─── Service ──────────────────────────────────────────────────────

export class CalendarService {

  /**
   * Check if Google Calendar integration is configured in env.
   */
  static isConfigured(): boolean {
    if (env.GOOGLE_CLIENT_ID === 'mock') {
      return true;
    }
    return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
  }

  /**
   * Generate the Google OAuth consent URL.
   * The `state` parameter carries the userId so the callback can associate tokens.
   */
  static getAuthUrl(userId: string): string {
    if (env.GOOGLE_CLIENT_ID === 'mock') {
      return `http://localhost:8080/api/calendar/callback?code=mock-code&state=${userId}`;
    }
    const oauth2Client = createOAuth2Client();
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',    // Ensures we get a refresh_token
      prompt: 'consent',         // Force consent to always get refresh_token
      scope: SCOPES,
      state: userId,             // Passed back in callback
    });
  }

  /**
   * Exchange the authorization code for tokens and store them.
   * Called from the OAuth callback route.
   */
  static async handleCallback(code: string, userId: string): Promise<void> {
    let accessToken = 'mock-access-token';
    let refreshToken = 'mock-refresh-token';
    let expiry = new Date(Date.now() + 3600 * 1000);

    if (env.GOOGLE_CLIENT_ID !== 'mock' && code !== 'mock-code') {
      const oauth2Client = createOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code);

      if (!tokens.access_token || !tokens.refresh_token) {
        throw new Error('Google OAuth did not return required tokens. User may need to re-authorize.');
      }

      accessToken = tokens.access_token;
      refreshToken = tokens.refresh_token;
      if (tokens.expiry_date) {
        expiry = new Date(tokens.expiry_date);
      }
    }

    // Upsert — one integration per user per provider
    await prisma.calendarIntegration.upsert({
      where: { userId_provider: { userId, provider: 'google' } },
      update: {
        accessToken,
        refreshToken,
        tokenExpiry: expiry,
        isActive: true,
      },
      create: {
        userId,
        provider: 'google',
        accessToken,
        refreshToken,
        tokenExpiry: expiry,
      },
    });

    log.info({ userId, isMock: env.GOOGLE_CLIENT_ID === 'mock' }, 'Google Calendar connected');
  }

  /**
   * Get an authenticated Calendar API client for a user.
   * Auto-refreshes expired tokens.
   */
  static async getCalendarClient(userId: string): Promise<calendar_v3.Calendar> {
    const integration = await prisma.calendarIntegration.findUnique({
      where: { userId_provider: { userId, provider: 'google' } },
    });

    if (!integration || !integration.isActive) {
      throw new Error('Google Calendar not connected. Please authorize via /api/calendar/connect');
    }

    if (env.GOOGLE_CLIENT_ID === 'mock') {
      const mockClient = {
        events: {
          insert: async ({ requestBody }: any) => {
            const id = 'mock-event-' + Math.random().toString(36).substring(2, 9);
            return {
              data: {
                id,
                htmlLink: `https://calendar.google.com/mock-event?id=${id}`,
                summary: requestBody.summary,
                description: requestBody.description,
                location: requestBody.location,
                start: requestBody.start,
                end: requestBody.end,
                status: 'confirmed',
              },
            };
          },
          patch: async ({ eventId, requestBody }: any) => {
            return {
              data: {
                id: eventId,
                htmlLink: `https://calendar.google.com/mock-event?id=${eventId}`,
                summary: requestBody.summary,
                description: requestBody.description,
                location: requestBody.location,
                start: requestBody.start,
                end: requestBody.end,
                status: 'confirmed',
              },
            };
          },
          delete: async () => {
            return { data: {} };
          },
          list: async () => {
            return {
              data: {
                items: [
                  {
                    id: 'mock-event-1',
                    htmlLink: 'https://calendar.google.com/mock-event?id=mock-event-1',
                    summary: 'Mock Event 1',
                    start: { dateTime: new Date(Date.now() + 3600000).toISOString() },
                    end: { dateTime: new Date(Date.now() + 7200000).toISOString() },
                    status: 'confirmed',
                  },
                  {
                    id: 'mock-event-2',
                    htmlLink: 'https://calendar.google.com/mock-event?id=mock-event-2',
                    summary: 'Mock Event 2',
                    start: { dateTime: new Date(Date.now() + 86400000).toISOString() },
                    end: { dateTime: new Date(Date.now() + 90000000).toISOString() },
                    status: 'confirmed',
                  },
                ],
              },
            };
          },
        },
      };
      return mockClient as any;
    }

    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      access_token: integration.accessToken,
      refresh_token: integration.refreshToken,
      expiry_date: integration.tokenExpiry.getTime(),
    });

    // Auto-refresh if expired
    if (integration.tokenExpiry < new Date()) {
      log.info({ userId }, 'Access token expired, refreshing...');
      const { credentials } = await oauth2Client.refreshAccessToken();

      await prisma.calendarIntegration.update({
        where: { id: integration.id },
        data: {
          accessToken: credentials.access_token!,
          tokenExpiry: new Date(credentials.expiry_date!),
          // refresh_token may not be returned on refresh — keep existing
          ...(credentials.refresh_token ? { refreshToken: credentials.refresh_token } : {}),
        },
      });
    }

    return google.calendar({ version: 'v3', auth: oauth2Client });
  }

  /**
   * Check if a user has an active Google Calendar connection.
   */
  static async isConnected(userId: string): Promise<boolean> {
    const integration = await prisma.calendarIntegration.findUnique({
      where: { userId_provider: { userId, provider: 'google' } },
    });
    return !!(integration?.isActive);
  }

  /**
   * Disconnect Google Calendar (revoke and delete tokens).
   */
  static async disconnect(userId: string): Promise<void> {
    const integration = await prisma.calendarIntegration.findUnique({
      where: { userId_provider: { userId, provider: 'google' } },
    });

    if (integration) {
      if (env.GOOGLE_CLIENT_ID !== 'mock') {
        // Try to revoke the token with Google
        try {
          const oauth2Client = createOAuth2Client();
          oauth2Client.setCredentials({ access_token: integration.accessToken });
          await oauth2Client.revokeToken(integration.accessToken);
        } catch (err) {
          log.warn({ err, userId }, 'Failed to revoke Google token — deleting locally anyway');
        }
      }

      await prisma.calendarIntegration.delete({ where: { id: integration.id } });
      log.info({ userId }, 'Google Calendar disconnected');
    }
  }

  // ─── Event CRUD ─────────────────────────────────────────────────

  /**
   * Create a calendar event.
   */
  static async createEvent(userId: string, input: CalendarEventInput): Promise<CalendarEventResult> {
    const calendar = await this.getCalendarClient(userId);
    const tz = input.timeZone || 'Asia/Kolkata';

    const event: calendar_v3.Schema$Event = {
      summary: input.summary,
      description: input.description,
      location: input.location,
      colorId: input.colorId,
      recurrence: input.recurrence,
    };

    if (input.isAllDay) {
      // All-day event uses date (not dateTime)
      event.start = { date: input.startTime.split('T')[0] };
      event.end = { date: input.endTime?.split('T')[0] || input.startTime.split('T')[0] };
    } else {
      event.start = { dateTime: input.startTime, timeZone: tz };
      event.end = {
        dateTime: input.endTime || new Date(new Date(input.startTime).getTime() + 3600000).toISOString(),
        timeZone: tz,
      };
    }

    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
    });

    const created = res.data;
    log.info({ userId, eventId: created.id, summary: input.summary }, 'Calendar event created');

    return {
      id: created.id!,
      htmlLink: created.htmlLink!,
      summary: created.summary || input.summary,
      start: (created.start?.dateTime || created.start?.date)!,
      end: (created.end?.dateTime || created.end?.date)!,
      status: created.status || 'confirmed',
    };
  }

  /**
   * Update an existing calendar event.
   */
  static async updateEvent(
    userId: string,
    eventId: string,
    input: Partial<CalendarEventInput>,
  ): Promise<CalendarEventResult> {
    const calendar = await this.getCalendarClient(userId);
    const tz = input.timeZone || 'Asia/Kolkata';

    const patch: calendar_v3.Schema$Event = {};
    if (input.summary) patch.summary = input.summary;
    if (input.description) patch.description = input.description;
    if (input.location) patch.location = input.location;
    if (input.startTime) {
      patch.start = input.isAllDay
        ? { date: input.startTime.split('T')[0] }
        : { dateTime: input.startTime, timeZone: tz };
    }
    if (input.endTime) {
      patch.end = input.isAllDay
        ? { date: input.endTime.split('T')[0] }
        : { dateTime: input.endTime, timeZone: tz };
    }

    const res = await calendar.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody: patch,
    });

    const updated = res.data;
    log.info({ userId, eventId }, 'Calendar event updated');

    return {
      id: updated.id!,
      htmlLink: updated.htmlLink!,
      summary: updated.summary || '',
      start: (updated.start?.dateTime || updated.start?.date)!,
      end: (updated.end?.dateTime || updated.end?.date)!,
      status: updated.status || 'confirmed',
    };
  }

  /**
   * Delete a calendar event.
   */
  static async deleteEvent(userId: string, eventId: string): Promise<void> {
    const calendar = await this.getCalendarClient(userId);
    await calendar.events.delete({ calendarId: 'primary', eventId });
    log.info({ userId, eventId }, 'Calendar event deleted');
  }

  /**
   * List upcoming events (for AI context and display).
   */
  static async listUpcomingEvents(userId: string, maxResults = 10): Promise<CalendarEventResult[]> {
    const calendar = await this.getCalendarClient(userId);

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    });

    return (res.data.items || []).map((e) => ({
      id: e.id!,
      htmlLink: e.htmlLink!,
      summary: e.summary || '(No title)',
      start: (e.start?.dateTime || e.start?.date)!,
      end: (e.end?.dateTime || e.end?.date)!,
      status: e.status || 'confirmed',
    }));
  }
}
