import "server-only";
import { GoogleGenAI, Modality } from "@google/genai";
import { JARVIS_SYSTEM_INSTRUCTION } from "../ai/personality";
import type { EphemeralSessionResponse } from "./types";

const DEFAULT_LIVE_MODEL = "gemini-3.1-flash-live-preview";
const DEFAULT_VOICE_NAME = "Puck";

const systemInstruction = JARVIS_SYSTEM_INSTRUCTION;

export async function createLiveEphemeralToken(): Promise<EphemeralSessionResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in local environment.");
  }

  const model = process.env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL;
  const voiceName = process.env.GEMINI_VOICE_NAME?.trim() || DEFAULT_VOICE_NAME;

  // Initialize server-side GoogleGenAI client with v1alpha for ephemeral auth tokens
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "v1alpha" },
  });

  const expireTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // Create single-use short-lived ephemeral token restricted to Gemini Live audio
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
