import { NextRequest, NextResponse } from "next/server";
import {
  COMPOSIO_USER_ID,
  getIntegrationsStatus,
  executeGmailFetch,
  executeGmailSend,
  executeCalendarFetch,
  executeCalendarCreate,
} from "@/services/integrations/composio";
import {
  saveMemory,
  searchMemories,
  deleteMatchingMemory,
  type MemoryCategory,
} from "@/services/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanHtmlSnippet(text: string): string {
  if (typeof text !== "string") return String(text || "");
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[\u200B-\u200D\uFEFF\u034F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCleanText(val: unknown): string {
  if (!val) return "";
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed === "object" && parsed !== null) {
        return extractCleanText(parsed.body || parsed.text || parsed.snippet || parsed.message || parsed);
      }
    } catch {
      // It is plain text
    }
    return cleanHtmlSnippet(val);
  }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    return extractCleanText(obj.body || obj.text || obj.snippet || obj.preview || "");
  }
  return String(val);
}

interface RawGmailMessage {
  sender?: string;
  from?: string;
  subject?: string;
  messageText?: string;
  preview?: string;
  snippet?: string;
  messageTimestamp?: string;
  date?: string;
}

function sanitizeGmailForVoice(
  rawResult: unknown,
  maxResults: number = 5
): {
  count: number;
  emails: Array<{
    sender: string;
    subject: string;
    date: string;
    preview: string;
  }>;
} {
  const dataObj = rawResult as {
    data?: { messages?: RawGmailMessage[]; response_data?: { messages?: RawGmailMessage[] } };
  };
  const rawList: RawGmailMessage[] = Array.isArray(dataObj?.data?.messages)
    ? dataObj.data.messages
    : Array.isArray(dataObj?.data?.response_data?.messages)
    ? dataObj.data.response_data.messages
    : [];

  const emails = rawList.slice(0, maxResults).map((m) => {
    const rawSender =
      typeof m.sender === "string"
        ? m.sender
        : typeof m.from === "string"
        ? m.from
        : "Unknown Sender";
    const sender = rawSender.trim();
    const subject =
      typeof m.subject === "string" && m.subject.trim() ? m.subject.trim() : "(No subject)";
    const rawSnippet = m.preview || m.snippet || m.messageText || "";
    const preview = extractCleanText(rawSnippet).slice(0, 180);
    const date =
      typeof m.messageTimestamp === "string"
        ? m.messageTimestamp
        : typeof m.date === "string"
        ? m.date
        : "";

    return { sender, subject, date, preview };
  });

  return {
    count: emails.length,
    emails,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, args } = body;

    console.log(`[JARVIS TRACE] source=voice`);
    console.log(`[JARVIS TRACE] user voice tool request received: ${name}`);
    console.log(`[JARVIS TRACE] composio session user=${COMPOSIO_USER_ID}`);

    if (name === "read_gmail_inbox") {
      console.log(`[JARVIS TRACE] classified intent=GMAIL_READ`);
      console.log(`[JARVIS TRACE] connected toolkit=gmail`);
      console.log(`[JARVIS TRACE] selected tool=GMAIL_FETCH_EMAILS`);
      
      const status = await getIntegrationsStatus();
      if (!status.gmail.connected) {
        console.log(`[JARVIS TRACE] tool success=false (Gmail disconnected)`);
        return NextResponse.json({
          success: false,
          error: "Gmail is not connected. Ask the user to connect Gmail in the UI.",
          actionRequired: "connect_gmail",
        });
      }

      console.log(`[JARVIS TRACE] executing tool=GMAIL_FETCH_EMAILS`);
      const emailData = (await executeGmailFetch({
        maxResults: args?.max_results || 5,
        query: args?.query,
      })) as { data?: { messages?: unknown[] } };

      const sanitizedResult = sanitizeGmailForVoice(emailData, args?.max_results || 5);
      const payloadString = JSON.stringify(sanitizedResult);
      const payloadSize = Buffer.byteLength(payloadString);

      console.log(`[JARVIS TRACE] tool success=true`);
      console.log(`[JARVIS TRACE] tool result count=${sanitizedResult.count} (voice payload size: ${payloadSize} bytes)`);

      // Hard safety guard: truncate if somehow exceeds 8KB
      if (payloadSize > 8192) {
        sanitizedResult.emails = sanitizedResult.emails.map((e) => ({
          sender: e.sender.slice(0, 50),
          subject: e.subject.slice(0, 80),
          date: e.date.slice(0, 30),
          preview: e.preview.slice(0, 100),
        }));
      }

      return NextResponse.json({
        success: true,
        result: sanitizedResult,
      });
    }

    if (name === "read_calendar_schedule") {
      console.log(`[JARVIS TRACE] classified intent=CALENDAR_READ`);
      console.log(`[JARVIS TRACE] connected toolkit=googlecalendar`);
      console.log(`[JARVIS TRACE] selected tool=GOOGLECALENDAR_EVENTS_LIST`);

      const status = await getIntegrationsStatus();
      if (!status.calendar.connected) {
        console.log(`[JARVIS TRACE] tool success=false (Calendar disconnected)`);
        return NextResponse.json({
          success: false,
          error: "Google Calendar is not connected. Ask the user to connect Calendar in the UI.",
          actionRequired: "connect_googlecalendar",
        });
      }

      console.log(`[JARVIS TRACE] executing tool=GOOGLECALENDAR_EVENTS_LIST`);
      const calData = (await executeCalendarFetch({
        maxResults: args?.max_results || 5,
      })) as { data?: { items?: unknown[] } };

      const count = calData?.data?.items?.length || 0;
      console.log(`[JARVIS TRACE] tool success=true`);
      console.log(`[JARVIS TRACE] tool result count=${count}`);

      return NextResponse.json({
        success: true,
        result: calData,
      });
    }

    if (name === "draft_or_send_email") {
      const isConfirmed = Boolean(args?.confirmed_by_user);
      if (!isConfirmed) {
        console.log(`[JARVIS TRACE] classified intent=GMAIL_DRAFT`);
        return NextResponse.json({
          success: true,
          status: "DRAFT_READY",
          message: `Draft prepared for ${args?.recipient_email || "recipient"}. Ask user: "Ready to send. Shall I send it?"`,
          draft: {
            recipient_email: args?.recipient_email,
            subject: args?.subject,
            body: args?.body,
          },
        });
      }

      console.log(`[JARVIS TRACE] classified intent=GMAIL_CONFIRM_SEND`);
      console.log(`[JARVIS TRACE] connected toolkit=gmail`);
      console.log(`[JARVIS TRACE] selected tool=GMAIL_SEND_EMAIL`);

      const status = await getIntegrationsStatus();
      if (!status.gmail.connected) {
        return NextResponse.json({
          success: false,
          error: "Gmail is not connected.",
          actionRequired: "connect_gmail",
        });
      }

      console.log(`[JARVIS TRACE] executing tool=GMAIL_SEND_EMAIL`);
      const sendRes = await executeGmailSend({
        recipient_email: args?.recipient_email || "recipient@example.com",
        subject: args?.subject || "Message from JARVIS",
        body: args?.body || "",
      });

      console.log(`[JARVIS TRACE] tool success=${sendRes.success}`);
      console.log(`[JARVIS TRACE] tool result messageId=${sendRes.messageId || "none"}`);

      return NextResponse.json({
        success: sendRes.success,
        result: sendRes,
      });
    }

    if (name === "create_calendar_event") {
      const isConfirmed = Boolean(args?.confirmed_by_user);
      if (!isConfirmed) {
        console.log(`[JARVIS TRACE] classified intent=CALENDAR_SCHEDULE_REQUEST`);
        return NextResponse.json({
          success: true,
          status: "PROPOSAL_READY",
          message: `Event '${args?.summary}' prepared for ${args?.start_datetime}. Ask user for confirmation to schedule it.`,
        });
      }

      console.log(`[JARVIS TRACE] classified intent=CALENDAR_CONFIRM_CREATE`);
      console.log(`[JARVIS TRACE] connected toolkit=googlecalendar`);
      console.log(`[JARVIS TRACE] selected tool=GOOGLECALENDAR_CREATE_EVENT`);

      const status = await getIntegrationsStatus();
      if (!status.calendar.connected) {
        return NextResponse.json({
          success: false,
          error: "Google Calendar is not connected.",
          actionRequired: "connect_googlecalendar",
        });
      }

      console.log(`[JARVIS TRACE] executing tool=GOOGLECALENDAR_CREATE_EVENT duration_minutes=${args?.duration_minutes || 60}`);
      const createRes = await executeCalendarCreate({
        summary: args?.summary || "Scheduled Meeting",
        start_datetime: args?.start_datetime || new Date(Date.now() + 86400000).toISOString().slice(0, 19),
        duration_minutes: args?.duration_minutes || 60,
      });

      console.log(`[JARVIS TRACE] tool success=${createRes.success}`);
      console.log(`[JARVIS TRACE] tool result eventId=${createRes.eventId || "none"}`);

      return NextResponse.json({
        success: createRes.success,
        result: createRes,
      });
    }

    if (name === "save_memory") {
      console.log(`[JARVIS TRACE] voice memory tool: save_memory content="${args?.content}"`);
      const content = String(args?.content || "").trim();
      const category = (args?.category as MemoryCategory) || "general";

      const res = await saveMemory({
        userId: COMPOSIO_USER_ID,
        content,
        category,
        source: "voice",
        importance: category === "preference" || category === "fact" ? 4 : 3,
      });

      if (!res.success) {
        return NextResponse.json({
          success: false,
          error: res.error || "Unable to save memory.",
        });
      }

      return NextResponse.json({
        success: true,
        result: {
          status: "MEMORY_SAVED",
          content,
          message: `I've saved that to your persistent memory: "${content}".`,
        },
      });
    }

    if (name === "search_memories") {
      console.log(`[JARVIS TRACE] voice memory tool: search_memories query="${args?.query}"`);
      const query = String(args?.query || "").trim();
      const results = await searchMemories({
        userId: COMPOSIO_USER_ID,
        query,
        limit: 5,
      });

      return NextResponse.json({
        success: true,
        result: {
          query,
          memories: results.map((m) => m.content),
          count: results.length,
        },
      });
    }

    if (name === "forget_memory") {
      console.log(`[JARVIS TRACE] voice memory tool: forget_memory query="${args?.query}"`);
      const query = String(args?.query || "").trim();
      const delRes = await deleteMatchingMemory({
        userId: COMPOSIO_USER_ID,
        query,
      });

      return NextResponse.json({
        success: delRes.success,
        result: {
          deletedCount: delRes.deletedCount,
          message:
            delRes.deletedCount > 0
              ? `I've removed that from your persistent memory.`
              : `I couldn't find any memory matching "${query}".`,
        },
      });
    }

    return NextResponse.json({ error: `Unknown tool: ${name}` }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal voice tool error";
    console.error("[Voice Tools] Error executing tool:", err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
