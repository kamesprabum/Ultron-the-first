import "server-only";
import { GoogleGenAI, Modality, Type, type Tool } from "@google/genai";
import { JARVIS_SYSTEM_INSTRUCTION } from "../ai/personality";
import type { EphemeralSessionResponse } from "./types";

const DEFAULT_LIVE_MODEL = "gemini-3.1-flash-live-preview";
const DEFAULT_VOICE_NAME = "Puck";

const systemInstruction = `${JARVIS_SYSTEM_INSTRUCTION}

You have real tool integrations with the user's Gmail and Google Calendar.
- When the user asks to check, read, or list emails, call \`read_gmail_inbox\`.
- When the user asks to write/send an email: first call \`draft_or_send_email\` with confirmed_by_user=false to prepare the draft, speak the draft details to the user, and ask "Ready to send. Shall I send it?". Only after the user clearly confirms, call \`draft_or_send_email\` with confirmed_by_user=true.
- When the user asks what is on their calendar or to check events, call \`read_calendar_schedule\`.
- When the user asks to schedule an event: if any date/time details are missing, ask for them. Then call \`create_calendar_event\` with confirmed_by_user=false to propose it. Once the user confirms, call \`create_calendar_event\` with confirmed_by_user=true.
- NEVER claim you sent an email or added an event unless the corresponding tool returned a successful result.`;

const LIVE_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "read_gmail_inbox",
        description: "Fetches and reads latest emails from the user's connected Gmail inbox.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            max_results: {
              type: Type.INTEGER,
              description: "Maximum number of emails to fetch (default 5).",
            },
            query: {
              type: Type.STRING,
              description: "Optional query search filter (e.g. sender, subject keyword).",
            },
          },
        },
      },
      {
        name: "read_calendar_schedule",
        description: "Retrieves upcoming events and schedule from the user's connected Google Calendar.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            max_results: {
              type: Type.INTEGER,
              description: "Maximum number of events to fetch (default 5).",
            },
          },
        },
      },
      {
        name: "draft_or_send_email",
        description: "Drafts or sends an email via Gmail. Set confirmed_by_user to true ONLY if user explicitly confirmed sending.",
        parameters: {
          type: Type.OBJECT,
          required: ["recipient_email", "subject", "body"],
          properties: {
            recipient_email: {
              type: Type.STRING,
              description: "Recipient's email address.",
            },
            subject: {
              type: Type.STRING,
              description: "Subject line of the email.",
            },
            body: {
              type: Type.STRING,
              description: "Body message of the email.",
            },
            confirmed_by_user: {
              type: Type.BOOLEAN,
              description: "True if user already heard the draft and said yes/send.",
            },
          },
        },
      },
      {
        name: "create_calendar_event",
        description: "Creates an event in Google Calendar. Set confirmed_by_user to true ONLY if user explicitly confirmed adding it.",
        parameters: {
          type: Type.OBJECT,
          required: ["summary", "start_datetime"],
          properties: {
            summary: {
              type: Type.STRING,
              description: "Title/summary of the calendar event.",
            },
            start_datetime: {
              type: Type.STRING,
              description: "Start datetime in ISO format (YYYY-MM-DDTHH:MM:SS).",
            },
            duration_minutes: {
              type: Type.INTEGER,
              description: "Duration of the event in minutes (default 60).",
            },
            confirmed_by_user: {
              type: Type.BOOLEAN,
              description: "True if user confirmed adding the event to their calendar.",
            },
          },
        },
      },
    ],
  },
];

export async function createLiveEphemeralToken(): Promise<EphemeralSessionResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in local environment.");
  }

  const model = process.env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL;
  const voiceName = process.env.GEMINI_VOICE_NAME?.trim() || DEFAULT_VOICE_NAME;

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "v1alpha" },
  });

  const expireTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // Create single-use short-lived ephemeral token configured with tools and system instruction
  const tokenResource = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime,
      liveConnectConstraints: {
        model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
          },
          tools: LIVE_TOOLS,
        },
      },
    },
  });

  if (!tokenResource?.name) {
    throw new Error("Failed to receive valid ephemeral token from Google Gen AI.");
  }

  return {
    token: tokenResource.name,
    model,
    voiceName,
    expireTime,
  };
}
