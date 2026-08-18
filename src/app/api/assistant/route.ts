import { NextResponse } from "next/server";
import { z } from "zod";
import { streamJarvisResponse, type ChatMessage } from "@/services/ai/gemini";

const messageItemSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(4000),
});

const requestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z.array(messageItemSchema).optional().default([]),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body." },
      { status: 400 }
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please send a valid message and conversation history." },
      { status: 400 }
    );
  }

  if (!process.env.GEMINI_API_KEY) {
    return new Response(
      "Gemini is not configured yet. Add GEMINI_API_KEY to your local environment, then I can assist you.",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      }
    );
  }

  const { message, history } = parsed.data;
  const encoder = new TextEncoder();

  try {
    // Acquire generator to verify initial setup
    const generator = streamJarvisResponse(
      history as ChatMessage[],
      message,
      request.signal
    );

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of generator) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        } catch (error) {
          console.error(
            "Jarvis streaming generation error:",
            error instanceof Error ? error.message : "unknown error"
          );
          controller.error(error);
        }
      },
      cancel() {
        console.log("[AI] Client aborted response stream");
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error(
      "Jarvis assistant request failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { error: "I couldn’t reach the AI service. Please check your network and try again." },
      { status: 503 }
    );
  }
}
