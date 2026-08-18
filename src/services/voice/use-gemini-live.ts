"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleGenAI } from "@google/genai/web";
import { AudioCaptureStream, AudioStreamPlayer } from "./pcm-audio";
import type { EphemeralSessionResponse, VoiceState } from "./types";

interface UseGeminiLiveOptions {
  onActivity?: (message: string) => void;
  onTranscript?: (text: string) => void;
}

export function useGeminiLive(options: UseGeminiLiveOptions = {}) {
  const [voiceState, setVoiceState] = useState<VoiceState>("IDLE");
  const [transcript, setTranscript] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sessionRef = useRef<Awaited<ReturnType<GoogleGenAI["live"]["connect"]>> | null>(null);
  const recorderRef = useRef<AudioCaptureStream | null>(null);
  const playerRef = useRef<AudioStreamPlayer | null>(null);
  const isStoppingRef = useRef<boolean>(false);
  const reconnectAttemptsRef = useRef<number>(0);
  const voiceStateRef = useRef<VoiceState>("IDLE");

  // Keep options in stable refs to avoid dependency cycles
  const onActivityRef = useRef(options.onActivity);
  const onTranscriptRef = useRef(options.onTranscript);

  useEffect(() => {
    onActivityRef.current = options.onActivity;
    onTranscriptRef.current = options.onTranscript;
  }, [options.onActivity, options.onTranscript]);

  const updateVoiceState = useCallback((newState: VoiceState) => {
    if (voiceStateRef.current !== newState) {
      console.log(`[LiveClient] State transition: ${voiceStateRef.current} -> ${newState}`);
      voiceStateRef.current = newState;
      setVoiceState(newState);
    }
  }, []);

  const stopVoice = useCallback(async () => {
    isStoppingRef.current = true;
    reconnectAttemptsRef.current = 0;

    if (recorderRef.current) {
      console.log("[LiveClient] Stopping microphone capture");
      recorderRef.current.stop();
      recorderRef.current = null;
    }

    if (playerRef.current) {
      console.log("[LiveClient] Closing audio playback engine");
      playerRef.current.close();
      playerRef.current = null;
    }

    if (sessionRef.current) {
      console.log("[LiveClient] Closing active Gemini Live session (intentional stop)");
      try {
        await sessionRef.current.close();
      } catch {
        // Ignored
      }
      sessionRef.current = null;
    }

    if (voiceStateRef.current !== "IDLE") {
      updateVoiceState("IDLE");
      onActivityRef.current?.("Voice mode deactivated");
    }
  }, [updateVoiceState]);

  const interrupt = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.interrupt();
    }
    updateVoiceState("INTERRUPTED");
    setTimeout(() => {
      if (sessionRef.current && !isStoppingRef.current) {
        updateVoiceState("LISTENING");
      }
    }, 400);
    onActivityRef.current?.("Interrupted");
  }, [updateVoiceState]);

  const startVoiceRef = useRef<(() => Promise<void>) | null>(null);

  const startVoice = useCallback(async () => {
    if (voiceStateRef.current !== "IDLE" && voiceStateRef.current !== "ERROR") {
      await stopVoice();
      return;
    }

    isStoppingRef.current = false;
    updateVoiceState("CONNECTING");
    setErrorMessage(null);
    onActivityRef.current?.("Requesting Live session token…");

    try {
      // 1. Fetch short-lived ephemeral token from secure server-only route
      const isReconnect = reconnectAttemptsRef.current > 0;
      console.log(`[LiveClient] Fetching session token (reconnect: ${isReconnect})...`);
      const res = await fetch("/api/voice/session", { method: "POST" });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to create session (${res.status})`);
      }

      const sessionData: EphemeralSessionResponse = await res.json();
      console.log(`[LiveClient] Ephemeral token received for model: ${sessionData.model}`);
      onActivityRef.current?.(`Connecting to ${sessionData.model}…`);

      // 2. Initialize player with real-time playback state tracking
      const player = new AudioStreamPlayer((isPlaying) => {
        if (!isPlaying && voiceStateRef.current === "SPEAKING") {
          updateVoiceState("LISTENING");
        }
      });
      await player.prepare();
      playerRef.current = player;

      // 3. Initialize client-side GoogleGenAI with ephemeral token
      const ai = new GoogleGenAI({
        apiKey: sessionData.token,
        httpOptions: { apiVersion: "v1alpha" },
      });

      // 4. Establish WebSocket Live Session
      console.log(`[LiveClient] Initiating WebSocket connection to Gemini Live...`);
      const session = await ai.live.connect({
        model: sessionData.model,
        callbacks: {
          onopen: async () => {
            console.log("[LiveClient] WebSocket handshake successful, session opened");
            onActivityRef.current?.("Gemini Live connected · Voice active");
            updateVoiceState("LISTENING");

            // 5. Initialize microphone capture once socket is live
            try {
              console.log("[LiveClient] Starting microphone capture at 16kHz PCM");
              const recorder = new AudioCaptureStream((base64Pcm) => {
                if (sessionRef.current && !isStoppingRef.current) {
                  try {
                    sessionRef.current.sendRealtimeInput({
                      audio: {
                        mimeType: "audio/pcm;rate=16000",
                        data: base64Pcm,
                      },
                    });
                  } catch (err) {
                    console.error("[LiveClient] Error sending audio chunk:", err);
                  }
                }
              });

              await recorder.start();
              recorderRef.current = recorder;
              onActivityRef.current?.("Microphone active · Streaming 16kHz PCM");
            } catch (micErr) {
              console.error("[LiveClient] Microphone permission/init error:", micErr);
              setErrorMessage("Microphone access denied. Please grant permission.");
              updateVoiceState("ERROR");
              await stopVoice();
            }
          },

          onmessage: (msg) => {
            if (isStoppingRef.current) return;

            if (msg.setupComplete) {
              console.log("[LiveClient] Gemini Live setupComplete confirmed by server");
            }

            if (msg.serverContent) {
              const parts = msg.serverContent.modelTurn?.parts || [];
              for (const part of parts) {
                // Audio chunk from Gemini Live
                if (part.inlineData?.data) {
                  updateVoiceState("SPEAKING");
                  player.playChunk(part.inlineData.data);
                }
                // Text transcript
                if (part.text) {
                  setTranscript((prev) => prev + part.text);
                  onTranscriptRef.current?.(part.text);
                }
              }

              // Interruption detection (Native Gemini Server-Side VAD)
              if (msg.serverContent.interrupted) {
                console.log("[LiveClient] User speech interrupted JARVIS. Halting audio playback.");
                player.interrupt();
                updateVoiceState("INTERRUPTED");
                onActivityRef.current?.("Barge-in: Interrupted JARVIS");
                setTimeout(() => {
                  if (!isStoppingRef.current && sessionRef.current) {
                    updateVoiceState("LISTENING");
                  }
                }, 300);
              }
            }
          },

          onerror: (err: unknown) => {
            let errorDetails = "Unknown WebSocket error";
            if (err instanceof Error) {
              errorDetails = `${err.name}: ${err.message}`;
            } else if (typeof err === "object" && err !== null) {
              const e = err as Record<string, unknown>;
              errorDetails = e.message ? String(e.message) : (e.type ? `Event (${e.type})` : "WebSocket Error Event");
            }
            console.error(`[LiveClient] WebSocket session error: ${errorDetails}`, {
              currentState: voiceStateRef.current,
              reconnectAttempts: reconnectAttemptsRef.current,
              isStopping: isStoppingRef.current,
            });
            if (!isStoppingRef.current) {
              setErrorMessage("Live session connection error.");
              updateVoiceState("ERROR");
              onActivityRef.current?.("Live session encountered an error");
            }
          },

          onclose: (e) => {
            const isIntentional = isStoppingRef.current;
            const isClean = e.wasClean || e.code === 1000;
            console.log(
              `[LiveClient] WebSocket closed: code=${e.code}, reason="${e.reason || "none"}", wasClean=${e.wasClean}, isIntentional=${isIntentional}, state=${voiceStateRef.current}`
            );

            if (!isStoppingRef.current) {
              // Only attempt reconnect for unexpected/abnormal closures (code !== 1000)
              if (!isClean && reconnectAttemptsRef.current < 2) {
                reconnectAttemptsRef.current += 1;
                console.log(`[LiveClient] Triggering automatic reconnect (${reconnectAttemptsRef.current}/2)...`);
                updateVoiceState("RECONNECTING");
                onActivityRef.current?.("Session disconnected. Reconnecting…");
                setTimeout(() => {
                  startVoiceRef.current?.();
                }, 1000);
              } else {
                updateVoiceState("IDLE");
                if (!isClean) {
                  setErrorMessage(`Connection closed (${e.reason || `code ${e.code}`}). Click the orb to restart.`);
                }
                onActivityRef.current?.("Session closed");
              }
            }
          },
        },
      });

      sessionRef.current = session;
    } catch (err) {
      console.error("[LiveClient] Failed to start voice mode:", err);
      const msg = err instanceof Error ? err.message : "Failed to start live voice session";
      setErrorMessage(msg);
      updateVoiceState("ERROR");
      onActivityRef.current?.(`Voice error: ${msg}`);
      await stopVoice();
    }
  }, [stopVoice, updateVoiceState]);

  useEffect(() => {
    startVoiceRef.current = startVoice;
  }, [startVoice]);

  const stopVoiceRef = useRef(stopVoice);
  useEffect(() => {
    stopVoiceRef.current = stopVoice;
  }, [stopVoice]);

  // Clean up on unmount only
  useEffect(() => {
    return () => {
      stopVoiceRef.current();
    };
  }, []);

  return {
    voiceState,
    transcript,
    errorMessage,
    isVoiceActive: voiceState !== "IDLE" && voiceState !== "ERROR",
    startVoice,
    stopVoice,
    interrupt,
  };
}
