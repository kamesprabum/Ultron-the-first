import "server-only";
import { GoogleGenAI } from "@google/genai";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const systemInstruction = `You are JARVIS, a calm, concise, professional personal operating-system assistant. Never invent calendar, email, task, memory, or tool results. Explain that connected services must be configured when a request requires them. Do not claim that an action was executed unless a tool returned success.`;

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

function buildContents(history: ChatMessage[], currentMessage: string) {
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

  contents.push({
    role: "user",
    parts: [{ text: currentMessage.trim() }],
  });

  return contents;
}

export async function* streamJarvisResponse(
  history: ChatMessage[] = [],
  message: string,
  abortSignal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const t0 = Date.now();
  console.log(`[AI timing] Request started at ${new Date(t0).toISOString()}`);

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
