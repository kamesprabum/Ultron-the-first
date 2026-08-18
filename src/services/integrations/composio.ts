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
 * Generates a Composio hosted OAuth Connect Link for Gmail or Google Calendar.
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
    const connectionRequest = await session.authorize(toolkitSlug);

    if (!connectionRequest.redirectUrl) {
      throw new Error(`No redirect URL returned by Composio for ${app}.`);
    }

    let redirectUrl = connectionRequest.redirectUrl;
    if (callbackUrl) {
      try {
        const urlObj = new URL(redirectUrl);
        urlObj.searchParams.set("callback_url", callbackUrl);
        redirectUrl = urlObj.toString();
      } catch {
        // Fall back to direct redirectUrl
      }
    }

    return { redirectUrl };
  } catch (err) {
    console.error(`[Composio] Error creating connect link for ${app}:`, err);
    throw err;
  }
}

/**
 * Checks the connection status for Gmail and Google Calendar for the stable user.
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
    const listResponse = await composio.connectedAccounts.list({
      userIds: [COMPOSIO_USER_ID],
    });

    const activeAccounts = listResponse.items || [];

    let gmailStatus: IntegrationAccountStatus = { connected: false, email: null };
    let calendarStatus: IntegrationAccountStatus = { connected: false, email: null };

    for (const acc of activeAccounts) {
      const toolkitSlug = acc.toolkit?.slug?.toLowerCase() || "";
      const status = (acc.status || "").toLowerCase();
      const isActive = status === "active" || status === "connected";

      if (isActive && (toolkitSlug === "gmail" || toolkitSlug.includes("gmail"))) {
        gmailStatus = {
          connected: true,
          email: acc.id || "Connected Account",
          accountId: acc.id,
        };
      }

      if (isActive && (toolkitSlug === "googlecalendar" || toolkitSlug.includes("calendar"))) {
        calendarStatus = {
          connected: true,
          email: acc.id || "Connected Account",
          accountId: acc.id,
        };
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
 * Read-only tool execution: Search or list emails from Gmail.
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
 * Read-only tool execution: Fetch calendar events from Google Calendar.
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
      max_results: params.maxResults || 5,
    });
    return result;
  } catch (err) {
    console.error("[Composio] Error executing GOOGLECALENDAR_EVENTS_LIST:", err);
    throw err;
  }
}
