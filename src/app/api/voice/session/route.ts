import { NextResponse } from "next/server";
import { createLiveEphemeralToken } from "@/services/voice/gemini-live-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const sessionData = await createLiveEphemeralToken();
    return NextResponse.json(sessionData, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal voice session error";
    console.error("Gemini Live session generation failed:", message);
    return NextResponse.json(
      { error: message || "Failed to initialize Gemini Live voice session." },
      { status: 503 }
    );
  }
}
