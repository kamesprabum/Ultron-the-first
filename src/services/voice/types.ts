export type VoiceState =
  | "IDLE"
  | "CONNECTING"
  | "LISTENING"
  | "THINKING"
  | "SPEAKING"
  | "INTERRUPTED"
  | "RECONNECTING"
  | "ERROR";

export interface EphemeralSessionResponse {
  token: string;
  model: string;
  voiceName: string;
  expireTime: string;
}

export interface VoiceConfig {
  model?: string;
  voiceName?: string;
  systemInstruction?: string;
}

export const VOICE_STATE_LABELS: Record<VoiceState, string> = {
  IDLE: "How can I help?",
  CONNECTING: "Connecting to Gemini Live…",
  LISTENING: "Listening… Speak anytime",
  THINKING: "JARVIS is thinking…",
  SPEAKING: "JARVIS speaking…",
  INTERRUPTED: "Interrupted",
  RECONNECTING: "Reconnecting live session…",
  ERROR: "Voice service error",
};
