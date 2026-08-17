import { NextResponse } from "next/server";
import { z } from "zod";
import { createJarvisResponse } from "@/services/ai/gemini";

const requestSchema = z.object({ message: z.string().trim().min(1).max(4000) });

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ response: "Please send a valid request." }, { status: 400 });
  try { return NextResponse.json({ response: await createJarvisResponse(parsed.data.message) }); }
  catch (error) { console.error("Jarvis assistant request failed", error instanceof Error ? error.message : "unknown error"); return NextResponse.json({ response: "I couldn’t reach the AI service. Check GEMINI_API_KEY and try again." }, { status: 503 }); }
}
