import { NextRequest, NextResponse } from "next/server";
import { getIntegrationConnectUrl } from "@/services/integrations/composio";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin") || req.nextUrl.origin || "http://localhost:3000";
    const callbackUrl = `${origin}/api/integrations/callback?service=gmail`;

    const { redirectUrl } = await getIntegrationConnectUrl("gmail", callbackUrl);
    return NextResponse.json({ redirectUrl, service: "gmail" });
  } catch (err) {
    console.error("[API] Error initiating Gmail connect:", err);
    const message = err instanceof Error ? err.message : "Failed to initiate Gmail connection";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
