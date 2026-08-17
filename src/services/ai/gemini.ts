import "server-only";
import { GoogleGenAI } from "@google/genai";

const systemInstruction = `You are JARVIS, a calm, concise, professional personal operating-system assistant. Never invent calendar, email, task, memory, or tool results. Explain that connected services must be configured when a request requires them. Do not claim that an action was executed unless a tool returned success.`;

export async function createJarvisResponse(message: string): Promise<string> {
  if (!process.env.GEMINI_API_KEY) return "Gemini is not configured yet. Add GEMINI_API_KEY to your local environment, then I can assist you.";
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const result = await ai.models.generateContent({ model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash", contents: message, config: { systemInstruction, temperature: 0.35 } });
  return result.text?.trim() || "I don’t have a response for that yet.";
}
