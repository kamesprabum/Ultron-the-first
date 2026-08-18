import "server-only";
import { GoogleGenAI } from "@google/genai";
import { JARVIS_SYSTEM_INSTRUCTION } from "./personality";
import {
  getIntegrationsStatus,
  executeGmailFetch,
  executeCalendarFetch,
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
      timeout: 12000,
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

function detectServiceIntent(query: string): "gmail" | "calendar" | null {
  const lower = query.toLowerCase();

  const isGmail =
    /\b(gmail|email|emails|inbox|messages|unread)\b/.test(lower) &&
    /\b(check|read|get|fetch|show|list|find|what|any|my|latest|recent)\b/.test(lower);

  if (isGmail) return "gmail";

  const isCalendar =
    /\b(calendar|schedule|agenda|events|meetings|appointments)\b/.test(lower) &&
    /\b(what|check|show|list|get|today|tomorrow|upcoming|my)\b/.test(lower);

  if (isCalendar) return "calendar";

  return null;
}

export async function* streamJarvisResponse(
  history: ChatMessage[] = [],
  message: string,
  abortSignal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const t0 = Date.now();
  console.log(`[AI timing] Request started at ${new Date(t0).toISOString()}`);

  const intent = detectServiceIntent(message);

  if (intent === "gmail") {
    const status = await getIntegrationsStatus();
    if (!status.gmail.connected) {
      console.log("[AI] Gmail is not connected. Yielding connection request.");
      yield "Your Gmail isn't connected yet. Connect it and I'll check your emails. [ACTION:connect_gmail]";
      return;
    }

    try {
      console.log("[AI] Gmail is connected. Fetching emails via Composio...");
      const emailData = await executeGmailFetch({ maxResults: 5 });
      const emailSummaryContext = JSON.stringify(emailData, null, 2);

      const ai = getClient();
      const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
      const contents = buildContents(
        history,
        message,
        `Retrieved live emails from user's connected Gmail account:\n${emailSummaryContext}`
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
      return;
    } catch (err) {
      console.error("[AI] Error executing Gmail tool:", err);
      yield "I encountered an issue fetching your emails. Please verify your Gmail connection in settings.";
      return;
    }
  }

  if (intent === "calendar") {
    const status = await getIntegrationsStatus();
    if (!status.calendar.connected) {
      console.log("[AI] Google Calendar is not connected. Yielding connection request.");
      yield "Your Google Calendar isn't connected yet. Connect it and I'll check today's schedule. [ACTION:connect_googlecalendar]";
      return;
    }

    try {
      console.log("[AI] Google Calendar is connected. Fetching events via Composio...");
      const calendarData = await executeCalendarFetch({ maxResults: 5 });
      const calendarSummaryContext = JSON.stringify(calendarData, null, 2);

      const ai = getClient();
      const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
      const contents = buildContents(
        history,
        message,
        `Retrieved live calendar events from user's connected Google Calendar:\n${calendarSummaryContext}`
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
      return;
    } catch (err) {
      console.error("[AI] Error executing Google Calendar tool:", err);
      yield "I encountered an issue fetching your calendar schedule. Please verify your Google Calendar connection in settings.";
      return;
    }
  }

  // Standard conversation streaming
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
    `[AI timing] Response completed in ${totalTime}ms (chunks: ${chunkCount}, TTFB: ${firstTokenTime ?? totalTime}ms)`
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
