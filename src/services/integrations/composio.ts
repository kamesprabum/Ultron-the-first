import "server-only";
import { Composio } from "@composio/core";

export const COMPOSIO_USER_ID = "jarvis-local-user";

export interface IntegrationAccountStatus {
  connected: boolean;
  email: string | null;
  accountId?: string;
}

export interface IntegrationsStatusResponse {
  gmail: IntegrationAccountStatus;
  calendar: IntegrationAccountStatus;
  configured: boolean;
  error?: string;
}

function getComposioClient(): Composio | null {
  const apiKey = process.env.COMPOSIO_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  return new Composio({ apiKey });
}

/**
 * Generates a Composio hosted OAuth Connect Link for Gmail or Google Calendar
 * with an explicit application callback URL.
 */
export async function getIntegrationConnectUrl(
  app: "gmail" | "googlecalendar",
  callbackUrl?: string
): Promise<{ redirectUrl: string }> {
  const composio = getComposioClient();
  if (!composio) {
    throw new Error("COMPOSIO_API_KEY is not configured in local environment.");
  }

  const toolkitSlug = app === "gmail" ? "gmail" : "googlecalendar";

  try {
    const session = await composio.create(COMPOSIO_USER_ID);
    const connectionRequest = await session.authorize(toolkitSlug, {
      callbackUrl,
    });

    if (!connectionRequest.redirectUrl) {
      throw new Error(`No redirect URL returned by Composio for ${app}.`);
    }

    return { redirectUrl: connectionRequest.redirectUrl };
  } catch (err) {
    console.error(`[Composio] Error creating connect link for ${app}:`, err);
    throw err;
  }
}

/**
 * Checks the connection status for Gmail and Google Calendar for jarvis-local-user.
 * Deterministically prioritizes the most recently updated active account.
 */
export async function getIntegrationsStatus(): Promise<IntegrationsStatusResponse> {
  const composio = getComposioClient();
  if (!composio) {
    return {
      gmail: { connected: false, email: null },
      calendar: { connected: false, email: null },
      configured: false,
      error: "COMPOSIO_API_KEY is missing in server environment",
    };
  }

  try {
    const activeAccountsRes = await composio.connectedAccounts.list({
      userIds: [COMPOSIO_USER_ID],
      statuses: ["ACTIVE"],
    });

    const activeAccounts = activeAccountsRes.items || [];

    // Deterministic sorting: newest active accounts first
    activeAccounts.sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    });

    let gmailStatus: IntegrationAccountStatus = { connected: false, email: null };
    let calendarStatus: IntegrationAccountStatus = { connected: false, email: null };

    for (const acc of activeAccounts) {
      const toolkitSlug = acc.toolkit?.slug?.toLowerCase() || "";
      const status = (acc.status || "").toUpperCase();
      const isActive = status === "ACTIVE";
      const accData = (acc.data || {}) as Record<string, unknown>;

      if (isActive && (toolkitSlug === "gmail" || toolkitSlug.includes("gmail"))) {
        if (!gmailStatus.connected) {
          const displayEmail =
            (typeof accData.email === "string" && accData.email) ||
            (typeof accData.user_email === "string" && accData.user_email) ||
            (typeof acc.wordId === "string" && acc.wordId) ||
            "Connected Gmail Account";

          gmailStatus = {
            connected: true,
            email: displayEmail,
            accountId: acc.id,
          };
        }
      }

      if (isActive && (toolkitSlug === "googlecalendar" || toolkitSlug.includes("calendar"))) {
        if (!calendarStatus.connected) {
          const displayEmail =
            (typeof accData.email === "string" && accData.email) ||
            (typeof accData.user_email === "string" && accData.user_email) ||
            (typeof acc.wordId === "string" && acc.wordId) ||
            "Connected Google Calendar";

          calendarStatus = {
            connected: true,
            email: displayEmail,
            accountId: acc.id,
          };
        }
      }
    }

    return {
      gmail: gmailStatus,
      calendar: calendarStatus,
      configured: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch connected accounts";
    return {
      gmail: { connected: false, email: null },
      calendar: { connected: false, email: null },
      configured: true,
      error: msg,
    };
  }
}

/**
 * Tool execution: Search or list emails from Gmail.
 */
export async function executeGmailFetch(params: {
  query?: string;
  maxResults?: number;
  unreadOnly?: boolean;
}): Promise<unknown> {
  const composio = getComposioClient();
  if (!composio) {
    throw new Error("Composio is not configured.");
  }

  try {
    const session = await composio.create(COMPOSIO_USER_ID);
    const result = await session.execute("GMAIL_FETCH_EMAILS", {
      query: params.query || (params.unreadOnly ? "is:unread" : undefined),
      max_results: params.maxResults || 5,
    });
    return result;
  } catch (err) {
    console.error("[Composio] Error executing GMAIL_FETCH_EMAILS:", err);
    throw err;
  }
}

/**
 * Tool execution: Create a draft in Gmail.
 */
export async function executeGmailDraft(params: {
  recipient_email?: string;
  subject?: string;
  body?: string;
}): Promise<{
  success: boolean;
  draftId?: string;
  recipient_email?: string;
  subject?: string;
  body?: string;
  error?: string;
}> {
  const composio = getComposioClient();
  if (!composio) {
    throw new Error("Composio is not configured.");
  }

  try {
    const session = await composio.create(COMPOSIO_USER_ID);
    const result = (await session.execute("GMAIL_CREATE_EMAIL_DRAFT", {
      recipient_email: params.recipient_email,
      subject: params.subject,
      body: params.body,
    })) as {
      data?: {
        response_data?: {
          id?: string;
          draft_id?: string;
        };
      };
      error?: string;
    };

    if (result.error) {
      return { success: false, error: result.error };
    }

    const draftId = result.data?.response_data?.id || result.data?.response_data?.draft_id;
    return {
      success: true,
      draftId,
      recipient_email: params.recipient_email,
      subject: params.subject,
      body: params.body,
    };
  } catch (err) {
    console.error("[Composio] Error executing GMAIL_CREATE_EMAIL_DRAFT:", err);
    const msg = err instanceof Error ? err.message : "Failed to create draft";
    return { success: false, error: msg };
  }
}

/**
 * Tool execution: Send an email via Gmail.
 */
export async function executeGmailSend(params: {
  recipient_email: string;
  subject: string;
  body: string;
}): Promise<{
  success: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
}> {
  const composio = getComposioClient();
  if (!composio) {
    throw new Error("Composio is not configured.");
  }

  try {
    const session = await composio.create(COMPOSIO_USER_ID);
    const result = (await session.execute("GMAIL_SEND_EMAIL", {
      recipient_email: params.recipient_email,
      subject: params.subject,
      body: params.body,
    })) as {
      data?: {
        response_data?: {
          id?: string;
          threadId?: string;
        };
      };
      error?: string;
    };

    if (result.error) {
      return { success: false, error: result.error };
    }

    const data = result.data as Record<string, unknown> | undefined;
    const responseData = (data?.response_data || data) as Record<string, unknown> | undefined;
    const messageId = (responseData?.id || responseData?.message_id || data?.id) as string | undefined;

    if (!messageId) {
      return {
        success: false,
        error: "Gmail API did not return a confirmed message ID.",
      };
    }

    return {
      success: true,
      messageId,
      threadId: (responseData?.threadId || data?.threadId) as string | undefined,
    };
  } catch (err) {
    console.error("[Composio] Error executing GMAIL_SEND_EMAIL:", err);
    const msg = err instanceof Error ? err.message : "Failed to send email";
    return { success: false, error: msg };
  }
}

/**
 * Tool execution: Fetch calendar events from Google Calendar.
 */
export async function executeCalendarFetch(params: {
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
}): Promise<unknown> {
  const composio = getComposioClient();
  if (!composio) {
    throw new Error("Composio is not configured.");
  }

  try {
    const session = await composio.create(COMPOSIO_USER_ID);
    const result = await session.execute("GOOGLECALENDAR_EVENTS_LIST", {
      time_min: params.timeMin || new Date().toISOString(),
      time_max: params.timeMax,
      max_results: params.maxResults || 10,
    });
    return result;
  } catch (err) {
    console.error("[Composio] Error executing GOOGLECALENDAR_EVENTS_LIST:", err);
    throw err;
  }
}

/**
 * Tool execution: Create a Google Calendar event.
 */
export async function executeCalendarCreate(params: {
  summary: string;
  start_datetime: string;
  timezone?: string;
  duration_minutes?: number;
  event_duration_hour?: number;
  event_duration_minutes?: number;
  description?: string;
  attendees?: string[];
}): Promise<{
  success: boolean;
  eventId?: string;
  htmlLink?: string;
  summary?: string;
  start?: unknown;
  error?: string;
  raw?: unknown;
}> {
  const composio = getComposioClient();
  if (!composio) {
    throw new Error("Composio is not configured.");
  }

  // Convert any incoming duration representation into valid hours and 0-59 minutes
  let totalMinutes = 60; // default 1 hour
  if (params.duration_minutes !== undefined && params.duration_minutes > 0) {
    totalMinutes = Math.round(params.duration_minutes);
  } else if (params.event_duration_hour !== undefined || params.event_duration_minutes !== undefined) {
    totalMinutes = (params.event_duration_hour ?? 0) * 60 + (params.event_duration_minutes ?? 0);
    if (totalMinutes <= 0) totalMinutes = 60;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const timezone = params.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  const startDate = new Date(params.start_datetime);
  const calculatedEnd = isNaN(startDate.getTime())
    ? "unknown"
    : new Date(startDate.getTime() + totalMinutes * 60 * 1000).toISOString();

  console.log(`[JARVIS CALENDAR TRACE] summary="${params.summary}"`);
  console.log(`[JARVIS CALENDAR TRACE] start_datetime="${params.start_datetime}"`);
  console.log(`[JARVIS CALENDAR TRACE] duration_minutes=${totalMinutes} (hours=${hours}, minutes=${minutes})`);
  console.log(`[JARVIS CALENDAR TRACE] calculated_end_datetime="${calculatedEnd}"`);
  console.log(`[JARVIS CALENDAR TRACE] timezone="${timezone}"`);
  console.log(`[JARVIS CALENDAR TRACE] tool name=GOOGLECALENDAR_CREATE_EVENT`);

  try {
    const session = await composio.create(COMPOSIO_USER_ID);
    const result = (await session.execute("GOOGLECALENDAR_CREATE_EVENT", {
      summary: params.summary,
      start_datetime: params.start_datetime,
      timezone,
      event_duration_hour: hours,
      event_duration_minutes: minutes,
      description: params.description || undefined,
      attendees: params.attendees || undefined,
    })) as {
      data?: {
        id?: string;
        response_data?: {
          id?: string;
          htmlLink?: string;
          summary?: string;
          start?: unknown;
        };
      };
      error?: string;
    };

    if (result.error) {
      console.log(`[JARVIS CALENDAR TRACE] Composio success=false`);
      console.log(`[JARVIS CALENDAR TRACE] API error message: ${result.error}`);
      return {
        success: false,
        error: result.error,
        raw: result,
      };
    }

    const data = result.data as Record<string, unknown> | undefined;
    const responseData = (data?.response_data || data) as Record<string, unknown> | undefined;
    const eventId = (responseData?.id || data?.id) as string | undefined;

    if (!eventId) {
      console.log(`[JARVIS CALENDAR TRACE] Composio success=false (missing event ID)`);
      return {
        success: false,
        error: "Google Calendar did not return a valid event confirmation ID.",
        raw: result,
      };
    }

    console.log(`[JARVIS CALENDAR TRACE] Composio success=true`);
    console.log(`[JARVIS CALENDAR TRACE] returned event ID=${eventId}`);

    return {
      success: true,
      eventId,
      htmlLink: (responseData?.htmlLink || data?.htmlLink) as string | undefined,
      summary: (responseData?.summary || params.summary) as string,
      start: responseData?.start || data?.start,
      raw: result,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create Google Calendar event";
    console.error("[Composio] Error executing GOOGLECALENDAR_CREATE_EVENT:", err);
    console.log(`[JARVIS CALENDAR TRACE] Composio success=false`);
    console.log(`[JARVIS CALENDAR TRACE] API error message: ${msg}`);
    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Tool execution: Delete a Google Calendar event.
 */
export async function executeCalendarDelete(params: {
  event_id: string;
}): Promise<{ success: boolean; error?: string }> {
  const composio = getComposioClient();
  if (!composio) {
    throw new Error("Composio is not configured.");
  }

  try {
    const session = await composio.create(COMPOSIO_USER_ID);
    await session.execute("GOOGLECALENDAR_DELETE_EVENT", {
      event_id: params.event_id,
    });
    return { success: true };
  } catch (err) {
    console.error("[Composio] Error executing GOOGLECALENDAR_DELETE_EVENT:", err);
    const msg = err instanceof Error ? err.message : "Failed to delete event";
    return { success: false, error: msg };
  }
}
