"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useGeminiLive } from "@/services/voice/use-gemini-live";
import { VOICE_STATE_LABELS, type VoiceState } from "@/services/voice/types";

type TextState = "IDLE" | "THINKING" | "RESPONDING" | "ERROR";

const TEXT_STATE_LABELS: Record<TextState, string> = {
  IDLE: "How can I help?",
  THINKING: "Processing your request…",
  RESPONDING: "JARVIS is responding…",
  ERROR: "I need your attention.",
};

interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export function ControlCenter() {
  const [textState, setTextState] = useState<TextState>("IDLE");
  const [time, setTime] = useState("");
  const [input, setInput] = useState("");
  const [reply, setReply] = useState("Connect your services or speak with JARVIS.");
  const [palette, setPalette] = useState(false);
  const [activity, setActivity] = useState<string[]>(["System ready", "Voice & Text online"]);
  const [history, setHistory] = useState<ChatHistoryItem[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);

  const addActivity = useCallback((msg: string) => {
    setActivity((prev) => [msg, ...prev].slice(0, 8));
  }, []);

  const handleTranscript = useCallback((text: string) => {
    setReply((prev) => prev + text);
  }, []);

  const {
    voiceState,
    transcript,
    errorMessage: voiceError,
    isVoiceActive,
    startVoice,
    stopVoice,
    interrupt: interruptVoice,
  } = useGeminiLive({
    onActivity: addActivity,
    onTranscript: handleTranscript,
  });

  // Effective state to show on UI
  const displayState: VoiceState | TextState = isVoiceActive ? voiceState : textState;

  useEffect(() => {
    const tick = () =>
      setTime(
        new Intl.DateTimeFormat(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format()
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
      }
      if (e.key === "Escape") {
        if (isVoiceActive) {
          interruptVoice();
        } else if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
          setTextState("IDLE");
        }
        setPalette(false);
      }
      if (e.key.toLowerCase() === "m" && !palette && document.activeElement?.tagName !== "INPUT") {
        if (isVoiceActive) {
          stopVoice();
        } else {
          startVoice();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [palette, isVoiceActive, startVoice, stopVoice, interruptVoice]);

  async function askText(e: FormEvent) {
    e.preventDefault();
    const query = input.trim();
    if (!query) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setInput("");
    setTextState("THINKING");
    setReply("");
    addActivity(`Text prompt: “${query}”`);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: query,
          history: history.slice(-10),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorMsg = "I couldn’t complete that request.";
        try {
          const errData = await response.json();
          if (errData.error) errorMsg = errData.error;
        } catch {
          // Default
        }
        setReply(errorMsg);
        setTextState("ERROR");
        addActivity("Request failed");
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No readable response stream available.");

      const decoder = new TextDecoder();
      let accumulated = "";
      let isFirst = true;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        accumulated += chunk;

        if (isFirst) {
          isFirst = false;
          setTextState("RESPONDING");
          addActivity("Receiving response…");
        }

        setReply(accumulated);
      }

      accumulated += decoder.decode();
      const finalReply = accumulated.trim() || "I don’t have a response for that yet.";
      setReply(finalReply);
      setTextState("IDLE");
      addActivity("Response ready");

      setHistory((prev) => [
        ...prev,
        { role: "user" as const, content: query },
        { role: "assistant" as const, content: finalReply },
      ].slice(-20));
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setReply((prev) => prev || "Request interrupted.");
        setTextState("IDLE");
        addActivity("Request interrupted");
        return;
      }
      setReply("Connection failed. Please check the server and try again.");
      setTextState("ERROR");
      addActivity("Connection error");
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }

  const toggleVoice = () => {
    if (isVoiceActive) {
      stopVoice();
    } else {
      startVoice();
    }
  };

  const getHeadingLabel = () => {
    if (isVoiceActive) {
      return VOICE_STATE_LABELS[voiceState];
    }
    return TEXT_STATE_LABELS[textState];
  };

  return (
    <main className="grid-bg min-h-screen px-4 py-5 sm:px-8">
      <header className="mx-auto flex max-w-7xl items-center justify-between border-b border-[var(--line)] pb-5">
        <div>
          <p className="text-xl font-semibold tracking-[.28em] text-cyan-100">JARVIS</p>
          <p className="mt-1 text-[10px] tracking-[.22em] text-[var(--muted)]">PERSONAL AI OPERATING SYSTEM</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
          <span className="hidden sm:inline">
            <i className={`mr-2 inline-block h-2 w-2 rounded-full ${isVoiceActive ? "bg-cyan-300 animate-ping" : "bg-[#7ef0b6]"}`} />
            {isVoiceActive ? "GEMINI LIVE ACTIVE" : "SYSTEM ONLINE"}
          </span>
          <span className="font-mono text-cyan-50">{time}</span>
          <button
            onClick={() => setPalette(true)}
            className="rounded-md border border-[var(--line)] px-3 py-2 text-cyan-100 transition-colors hover:bg-cyan-100/10"
          >
            ⌘K
          </button>
          <button className="rounded-md border border-[var(--line)] px-3 py-2 text-cyan-100 transition-colors hover:bg-cyan-100/10">
            ⚙
          </button>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-5 pt-8 lg:grid-cols-[1fr_1.55fr_1fr]">
        <aside className="space-y-5">
          <Overview title="CALENDAR" caption="Connect Google Calendar" icon="◫" />
          <Overview title="TASKS" caption="Connect Convex to sync tasks" icon="✓" />
          <Overview title="INBOX" caption="Connect Gmail" icon="✉" />
        </aside>

        <section className="panel relative flex min-h-[530px] flex-col items-center justify-center overflow-hidden rounded-2xl px-5 py-10 text-center">
          <p className="absolute top-6 text-[10px] tracking-[.25em] text-[var(--muted)]">
            {isVoiceActive ? `GEMINI LIVE VOICE / ${voiceState}` : `TEXT INTERFACE / ${textState}`}
          </p>

          <button
            onClick={toggleVoice}
            aria-label="Toggle voice mode"
            className={`orb ${
              voiceState === "LISTENING" || voiceState === "SPEAKING" ? "listening" : ""
            } relative grid h-40 w-40 place-items-center rounded-full border border-cyan-100/40 bg-[radial-gradient(circle_at_35%_30%,#3a9aa2,#12363b_47%,#091c20)] transition-transform hover:scale-105`}
          >
            <span className="text-4xl">
              {voiceState === "LISTENING"
                ? "◉"
                : voiceState === "SPEAKING"
                ? "◈"
                : voiceState === "CONNECTING" || voiceState === "RECONNECTING"
                ? "◌"
                : voiceState === "INTERRUPTED"
                ? "✕"
                : voiceState === "ERROR"
                ? "!"
                : "◌"}
            </span>
          </button>

          <h1 className="mt-14 text-2xl font-light tracking-wide text-cyan-50">
            {getHeadingLabel()}
          </h1>

          <div className="mt-3 max-w-md min-h-[48px] text-sm leading-6 text-[var(--muted)]">
            <p className="whitespace-pre-wrap">
              {isVoiceActive && transcript
                ? transcript
                : voiceError
                ? voiceError
                : reply || (displayState === "THINKING" ? "Thinking…" : "")}
            </p>
          </div>

          <form onSubmit={askText} className="mt-8 flex w-full max-w-xl gap-2 rounded-xl border border-[var(--line)] bg-black/15 p-1.5">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isVoiceActive ? "Speak to JARVIS or type here…" : "Ask JARVIS anything…"}
              className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-[#587178]"
            />
            <button
              type="submit"
              disabled={textState === "THINKING"}
              className="rounded-lg bg-cyan-200 px-4 py-2 text-sm font-medium text-[#062226] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {textState === "THINKING" ? "Thinking…" : "Send"}
            </button>
          </form>

          <div className="mt-4 flex gap-3 text-[11px] text-[var(--muted)]">
            <button
              onClick={toggleVoice}
              className={`hover:text-cyan-200 transition-colors ${isVoiceActive ? "text-cyan-300 font-semibold" : ""}`}
            >
              M · {isVoiceActive ? "stop voice" : "voice mode"}
            </button>
            <button
              onClick={() => {
                if (isVoiceActive) {
                  interruptVoice();
                } else if (abortControllerRef.current) {
                  abortControllerRef.current.abort();
                  abortControllerRef.current = null;
                  setTextState("IDLE");
                }
              }}
              className="hover:text-cyan-200 transition-colors"
            >
              Esc · interrupt
            </button>
            <button
              onClick={() => {
                if (!isVoiceActive) {
                  startVoice();
                }
              }}
              className="hover:text-cyan-200 transition-colors"
            >
              ⚡ Live session
            </button>
          </div>
        </section>

        <aside className="panel rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs tracking-[.18em] text-cyan-100">ACTIVITY STREAM</p>
              <p className="mt-1 text-[11px] text-[var(--muted)]">Live operations</p>
            </div>
            <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-200" />
          </div>

          <div className="mt-7">
            {activity.map((item, i) => (
              <div className="relative border-l border-[var(--line)] pb-6 pl-5 text-sm text-[#bdd0d3]" key={item + i}>
                <i className={`absolute -left-[4px] top-1 h-2 w-2 rounded-full ${i === 0 ? "bg-cyan-200" : "bg-[#52777c]"}`} />
                <p className="text-[10px] text-[var(--muted)]">{time || "--:--"}</p>
                <p className="mt-1">{item}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-dashed border-[var(--line)] p-3 text-xs leading-5 text-[var(--muted)]">
            No activity is simulated. Connect providers and Jarvis will stream real operations here.
          </div>
        </aside>
      </section>

      {palette && (
        <div
          className="fixed inset-0 z-10 grid place-items-start bg-[#021012bb] p-5 pt-[16vh] backdrop-blur-sm"
          onClick={() => setPalette(false)}
        >
          <div className="panel w-full max-w-lg rounded-xl p-2" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              placeholder="Search commands…"
              className="w-full bg-transparent px-4 py-3 text-sm outline-none placeholder:text-[var(--muted)]"
            />
            {["Toggle Voice Mode", "Ask JARVIS", "View Calendar", "View Tasks", "View Memories", "Settings"].map((c, i) => (
              <button
                key={c}
                onClick={() => {
                  setPalette(false);
                  if (i === 0) toggleVoice();
                  if (i === 1) document.querySelector<HTMLInputElement>("input[placeholder^='Ask']")?.focus();
                }}
                className="flex w-full items-center justify-between rounded-lg px-4 py-3 text-left text-sm hover:bg-cyan-100/10"
              >
                <span>{c}</span>
                <span className="text-xs text-[var(--muted)]">↵</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function Overview({ title, caption, icon }: { title: string; caption: string; icon: string }) {
  return (
    <section className="panel rounded-2xl p-5">
      <div className="flex items-start justify-between">
        <p className="text-[11px] tracking-[.18em] text-[var(--muted)]">{title}</p>
        <span className="text-lg text-cyan-100">{icon}</span>
      </div>
      <p className="mt-7 text-3xl font-light text-cyan-50">—</p>
      <p className="mt-2 text-xs text-[var(--muted)]">{caption}</p>
      <button className="mt-5 text-xs text-cyan-200">Configure →</button>
    </section>
  );
}
