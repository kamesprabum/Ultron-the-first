import "server-only";
import { GoogleGenAI } from "@google/genai";
import { JARVIS_SYSTEM_INSTRUCTION } from "./personality";
import {
  COMPOSIO_USER_ID,
  getIntegrationsStatus,
  executeGmailFetch,
  executeGmailSend,
  executeCalendarFetch,
  executeCalendarCreate,
} from "@/services/integrations/composio";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const systemInstruction = JARVIS_SYSTEM_INSTRUCTION;

const DEFAULT_MODEL = "gemini-3.5-flash-lite";

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      retryOptions: {
        attempts: 2,
        initialDelay: 0.5,
        maxDelay: 1.5,
      },
      timeout: 15000,
    },
  });
}

function buildContents(history: ChatMessage[], currentMessage: string, extraContext?: string) {
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

  for (const msg of history) {
    if (!msg.content || typeof msg.content !== "string") continue;
    const trimmed = msg.content.trim();
    if (!trimmed) continue;
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: trimmed }],
    });
  }

  const promptText = extraContext
    ? `[SYSTEM CONTEXT FROM CONNECTED SERVICE]\n${extraContext}\n\n[USER QUERY]\n${currentMessage.trim()}`
    : currentMessage.trim();

  contents.push({
    role: "user",
    parts: [{ text: promptText }],
  });

  return contents;
}

interface AgentClassification {
  intent:
    | "GMAIL_READ"
    | "GMAIL_DRAFT"
    | "GMAIL_CONFIRM_SEND"
    | "CALENDAR_READ"
    | "CALENDAR_SCHEDULE_REQUEST"
    | "CALENDAR_CONFIRM_CREATE"
    | "GENERAL_CHAT";
  emailDetails?: {
    recipient_name?: string;
    recipient_email?: string;
    subject?: string;
    body?: string;
  } | null;
  eventDetails?: {
    summary?: string;
    start_datetime?: string;
    duration_minutes?: number;
    description?: string;
    is_incomplete?: boolean;
    clarification_prompt?: string | null;
  } | null;
}

function formatDuration(minutes: number): string {
  if (minutes === 60) return "1 hour";
  if (minutes < 60) return `${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} hours`;
  return `${h} hour${h > 1 ? "s" : ""} ${m} minute${m > 1 ? "s" : ""}`;
}

async function classifyIntentAndExtract(
  query: string,
  history: ChatMessage[]
): Promise<AgentClassification> {
  const ai = getClient();
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";

  const historyContext = history
    .slice(-6)
    .map((h) => `${h.role}: ${h.content}`)
    .join("\n");

  const prompt = `You are the intent classification and entity extraction layer for JARVIS.
Current Reference Time: ${now.toISOString()} (${now.toString()})
User Local Timezone: ${timezone}

Recent Conversation History:
${historyContext || "None"}

Current User Request: "${query}"

Classify into exactly one intent:
1. "GMAIL_READ": User wants to search or read emails / inbox.
2. "GMAIL_DRAFT": User wants to write or compose an email to someone.
3. "GMAIL_CONFIRM_SEND": User is confirming sending a previously drafted email from history (e.g. "yes", "send it", "confirm", "send").
4. "CALENDAR_READ": User is checking schedule, meetings, or listing events.
5. "CALENDAR_SCHEDULE_REQUEST": User asks to create, propose, or schedule a calendar event or meeting.
6. "CALENDAR_CONFIRM_CREATE": User is confirming adding a previously proposed calendar event from history (e.g. "yes", "add it", "confirm", "schedule it").
7. "GENERAL_CHAT": General conversation or queries unrelated to Gmail or Calendar tools.

CRITICAL DURATION & PARAMETER INSTRUCTIONS:
- For CALENDAR_SCHEDULE_REQUEST: Extract summary, start_datetime formatted as ISO YYYY-MM-DDTHH:MM:SS in ${timezone}. Calculate duration_minutes as total integer minutes (e.g., 23 hours = 1380, 2 hours = 120, 1h30m = 90, 30 min = 30).
- If time or date is missing, set is_incomplete to true and provide clarification_prompt (e.g. "What time would you like to schedule the meeting?").
- If user says "yes", "send it", "confirm", or similar after an email draft was prepared in history, you MUST return GMAIL_CONFIRM_SEND and extract emailDetails from the previous draft in history.
- If user says "yes", "add it", "confirm", or similar after a calendar event was proposed in history, you MUST return CALENDAR_CONFIRM_CREATE and extract eventDetails from the previous proposal in history.

Return ONLY valid JSON matching this schema:
{
  "intent": "GMAIL_READ" | "GMAIL_DRAFT" | "GMAIL_CONFIRM_SEND" | "CALENDAR_READ" | "CALENDAR_SCHEDULE_REQUEST" | "CALENDAR_CONFIRM_CREATE" | "GENERAL_CHAT",
  "emailDetails": {
    "recipient_name": "string",
    "recipient_email": "string",
    "subject": "string",
    "body": "string"
  } | null,
  "eventDetails": {
    "summary": "string",
    "start_datetime": "string",
    "duration_minutes": 60,
    "description": "string",
    "is_incomplete": false,
    "clarification_prompt": null
  } | null
}`;

  try {
    const res = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const parsed = JSON.parse(res.text || "{}");
    const item = Array.isArray(parsed) ? parsed[0] : parsed;
    return item as AgentClassification;
  } catch (err) {
    console.error("[AI] Error in agent classification:", err);
    return { intent: "GENERAL_CHAT" };
  }
}

export async function* streamJarvisResponse(
  history: ChatMessage[] = [],
  message: string,
  abortSignal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const t0 = Date.now();
  console.log(`[JARVIS TRACE] source=text`);
  console.log(`[JARVIS TRACE] user message received: "${message.slice(0, 100)}"`);

  const classification = await classifyIntentAndExtract(message, history);
  console.log(`[JARVIS TRACE] classified intent=${classification.intent}`);
  console.log(`[JARVIS TRACE] composio session user=${COMPOSIO_USER_ID}`);

  // 1. GMAIL READ
  if (classification.intent === "GMAIL_READ") {
    console.log(`[JARVIS TRACE] connected toolkit=gmail`);
    console.log(`[JARVIS TRACE] selected tool=GMAIL_FETCH_EMAILS`);

    const status = await getIntegrationsStatus();
    if (!status.gmail.connected) {
      console.log(`[JARVIS TRACE] tool success=false (Gmail disconnected)`);
      yield "Your Gmail isn't connected yet. Connect it and I'll check your emails. [ACTION:connect_gmail]";
      return;
    }

    try {
      console.log(`[JARVIS TRACE] executing tool=GMAIL_FETCH_EMAILS`);
      const emailData = (await executeGmailFetch({ maxResults: 5 })) as { data?: { messages?: unknown[] } };
      const emailSummaryContext = JSON.stringify(emailData, null, 2);
      const count = emailData?.data?.messages?.length || 0;
      console.log(`[JARVIS TRACE] tool success=true`);
      console.log(`[JARVIS TRACE] tool result count=${count}`);

      const ai = getClient();
      const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
      const contents = buildContents(
        history,
        message,
        `Retrieved live emails from user's connected Gmail account:\n${emailSummaryContext}\n\nNote: Summarize the real sender, subject, and snippet accurately.`
      );

      const responseStream = await ai.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction,
          temperature: 0.35,
          abortSignal,
        },
      });

      for await (const chunk of responseStream) {
        if (abortSignal?.aborted) return;
        if (chunk.text) yield chunk.text;
      }
      console.log(`[JARVIS TRACE] final response generated`);
      return;
    } catch (err) {
      console.error("[AI] Error executing Gmail tool:", err);
      console.log(`[JARVIS TRACE] tool success=false (error)`);
      yield "I encountered an issue fetching your emails. Please verify your Gmail connection.";
      return;
    }
  }

  // 2. GMAIL DRAFT (Safety: Do NOT send automatically. Prepare draft and ask confirmation.)
  if (classification.intent === "GMAIL_DRAFT") {
    console.log(`[JARVIS TRACE] classified intent=GMAIL_DRAFT (safety hold: awaiting confirmation)`);
    const details = classification.emailDetails;
    const recipient = details?.recipient_email || `${details?.recipient_name || "recipient"}@example.com`;
    const subject = details?.subject || "Message from JARVIS";
    const body = details?.body || message;

    yield `I have prepared the draft:

• **To:** ${details?.recipient_name ? `${details.recipient_name} <${recipient}>` : recipient}
• **Subject:** ${subject}
• **Message:**
"${body}"

Ready to send. Shall I send it?`;
    console.log(`[JARVIS TRACE] final response generated (draft presented)`);
    return;
  }

  // 3. GMAIL CONFIRM SEND (User confirmed sending previously drafted email)
  if (classification.intent === "GMAIL_CONFIRM_SEND") {
    console.log(`[JARVIS TRACE] connected toolkit=gmail`);
    console.log(`[JARVIS TRACE] selected tool=GMAIL_SEND_EMAIL`);

    const status = await getIntegrationsStatus();
    if (!status.gmail.connected) {
      console.log(`[JARVIS TRACE] tool success=false (Gmail disconnected)`);
      yield "Your Gmail isn't connected yet. Connect it and I'll send your email. [ACTION:connect_gmail]";
      return;
    }

    const details = classification.emailDetails;
    const recipient = details?.recipient_email || "recipient@example.com";
    const subject = details?.subject || "Message from JARVIS";
    const body = details?.body || "Hello";

    try {
      console.log(`[JARVIS TRACE] executing tool=GMAIL_SEND_EMAIL`);
      const sendRes = await executeGmailSend({
        recipient_email: recipient,
        subject,
        body,
      });

      console.log(`[JARVIS TRACE] tool success=${sendRes.success}`);
      console.log(`[JARVIS TRACE] tool result messageId=${sendRes.messageId || "none"}`);

      if (!sendRes.success) {
        yield `I couldn't send the email because the Gmail action failed: ${sendRes.error || "Execution error"}.`;
        return;
      }

      yield `Done, I've sent the email to ${details?.recipient_name || recipient}.`;
      console.log(`[JARVIS TRACE] final response generated`);
      return;
    } catch (err) {
      console.error("[AI] Error executing Gmail send tool:", err);
      console.log(`[JARVIS TRACE] tool success=false (error)`);
      yield "I couldn't send the email because the Gmail action failed.";
      return;
    }
  }

  // 4. CALENDAR SCHEDULE REQUEST (Prepare event, ask clarification if incomplete, ask confirmation)
  if (classification.intent === "CALENDAR_SCHEDULE_REQUEST") {
    const ev = classification.eventDetails;

    if (ev?.is_incomplete && ev?.clarification_prompt) {
      console.log(`[JARVIS TRACE] classified intent=CALENDAR_SCHEDULE_REQUEST (incomplete: asking clarification)`);
      yield ev.clarification_prompt;
      return;
    }

    console.log(`[JARVIS TRACE] classified intent=CALENDAR_SCHEDULE_REQUEST (safety hold: awaiting confirmation)`);
    const start = ev?.start_datetime ? new Date(ev.start_datetime) : new Date(Date.now() + 86400000);
    const durationStr = formatDuration(ev?.duration_minutes ?? 60);
    const timeStr = isNaN(start.getTime())
      ? ev?.start_datetime || "tomorrow"
      : start.toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });

    yield `I've prepared the event "${ev?.summary || "Meeting"}" for ${timeStr} (${durationStr}). Shall I add it to your Google Calendar?`;
    console.log(`[JARVIS TRACE] final response generated (event proposed)`);
    return;
  }

  // 5. CALENDAR CONFIRM CREATE (User confirmed adding previously proposed event)
  if (classification.intent === "CALENDAR_CONFIRM_CREATE") {
    console.log(`[JARVIS TRACE] connected toolkit=googlecalendar`);
    console.log(`[JARVIS TRACE] selected tool=GOOGLECALENDAR_CREATE_EVENT`);

    const status = await getIntegrationsStatus();
    if (!status.calendar.connected) {
      console.log(`[JARVIS TRACE] tool success=false (Calendar disconnected)`);
      yield "Your Google Calendar isn't connected yet. Connect it and I'll add events to your schedule. [ACTION:connect_googlecalendar]";
      return;
    }

    const ev = classification.eventDetails;
    const summary = ev?.summary || "Scheduled Event";
    const startDatetime = ev?.start_datetime || new Date(Date.now() + 86400000).toISOString().slice(0, 19);
    const durationMinutes = ev?.duration_minutes ?? 60;

    try {
      console.log(`[JARVIS TRACE] executing tool=GOOGLECALENDAR_CREATE_EVENT duration_minutes=${durationMinutes}`);
      const createRes = await executeCalendarCreate({
        summary,
        start_datetime: startDatetime,
        duration_minutes: durationMinutes,
        description: ev?.description,
      });

      console.log(`[JARVIS TRACE] tool success=${createRes.success}`);
      console.log(`[JARVIS TRACE] tool result eventId=${createRes.eventId || "none"}`);

      if (!createRes.success) {
        yield `I couldn't add that event because the Google Calendar action failed: ${createRes.error || "Execution error"}.`;
        return;
      }

      const start = new Date(startDatetime);
      const timeStr = isNaN(start.getTime())
        ? startDatetime
        : start.toLocaleString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          });

      yield `Done, I've added the event "${createRes.summary}" for ${timeStr} to your Google Calendar.`;
      console.log(`[JARVIS TRACE] final response generated`);
      return;
    } catch (err) {
      console.error("[AI] Error executing Calendar create tool:", err);
      console.log(`[JARVIS TRACE] tool success=false (error)`);
      yield "I couldn't add that event because the Google Calendar action failed.";
      return;
    }
  }

  // 6. CALENDAR READ
  if (classification.intent === "CALENDAR_READ") {
    console.log(`[JARVIS TRACE] connected toolkit=googlecalendar`);
    console.log(`[JARVIS TRACE] selected tool=GOOGLECALENDAR_EVENTS_LIST`);

    const status = await getIntegrationsStatus();
    if (!status.calendar.connected) {
      console.log(`[JARVIS TRACE] tool success=false (Calendar disconnected)`);
      yield "Your Google Calendar isn't connected yet. Connect it and I'll check today's schedule. [ACTION:connect_googlecalendar]";
      return;
    }

    try {
      console.log(`[JARVIS TRACE] executing tool=GOOGLECALENDAR_EVENTS_LIST`);
      const calendarData = (await executeCalendarFetch({ maxResults: 10 })) as { data?: { items?: unknown[] } };
      const calendarSummaryContext = JSON.stringify(calendarData, null, 2);
      const count = calendarData?.data?.items?.length || 0;
      console.log(`[JARVIS TRACE] tool success=true`);
      console.log(`[JARVIS TRACE] tool result count=${count}`);

      const ai = getClient();
      const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
      const contents = buildContents(
        history,
        message,
        `Retrieved live calendar events from user's connected Google Calendar:\n${calendarSummaryContext}\n\nNote: State the events clearly. If no events exist in the returned list, tell the user they have no scheduled events.`
      );

      const responseStream = await ai.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction,
          temperature: 0.35,
          abortSignal,
        },
      });

      for await (const chunk of responseStream) {
        if (abortSignal?.aborted) return;
        if (chunk.text) yield chunk.text;
      }
      console.log(`[JARVIS TRACE] final response generated`);
      return;
    } catch (err) {
      console.error("[AI] Error executing Google Calendar tool:", err);
      console.log(`[JARVIS TRACE] tool success=false (error)`);
      yield "I encountered an issue fetching your calendar schedule. Please verify your Google Calendar connection.";
      return;
    }
  }

  // 7. GENERAL CHAT (Standard Progressive Streaming)
  console.log(`[JARVIS TRACE] selected path=general_streaming`);
  const ai = getClient();
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const contents = buildContents(history, message);

  const responseStream = await ai.models.generateContentStream({
    model,
    contents,
    config: {
      systemInstruction,
      temperature: 0.35,
      abortSignal,
    },
  });

  let firstTokenTime: number | null = null;
  let chunkCount = 0;

  for await (const chunk of responseStream) {
    if (abortSignal?.aborted) {
      console.log(`[AI timing] Request aborted after ${Date.now() - t0}ms`);
      return;
    }

    const text = chunk.text;
    if (text) {
      if (firstTokenTime === null) {
        firstTokenTime = Date.now() - t0;
        console.log(`[AI timing] First chunk received in ${firstTokenTime}ms`);
      }
      chunkCount++;
      yield text;
    }
  }

  const totalTime = Date.now() - t0;
  console.log(
    `[JARVIS TRACE] final response generated in ${totalTime}ms (chunks: ${chunkCount})`
  );
}

export async function createJarvisResponse(
  message: string,
  history: ChatMessage[] = []
): Promise<string> {
  if (!process.env.GEMINI_API_KEY) {
    return "Gemini is not configured yet. Add GEMINI_API_KEY to your local environment, then I can assist you.";
  }
  let fullText = "";
  for await (const chunk of streamJarvisResponse(history, message)) {
    fullText += chunk;
  }
  return fullText.trim() || "I don’t have a response for that yet.";
}
