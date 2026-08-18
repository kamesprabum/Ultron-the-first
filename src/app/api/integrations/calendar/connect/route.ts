import { NextRequest, NextResponse } from "next/server";
import { getIntegrationConnectUrl } from "@/services/integrations/composio";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin") || req.nextUrl.origin || "http://localhost:3000";
    const callbackUrl = `${origin}/api/integrations/callback?service=googlecalendar`;

    const { redirectUrl } = await getIntegrationConnectUrl("googlecalendar", callbackUrl);
    return NextResponse.json({ redirectUrl, service: "googlecalendar" });
  } catch (err) {
    console.error("[API] Error initiating Google Calendar connect:", err);
    const message = err instanceof Error ? err.message : "Failed to initiate Google Calendar connection";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
