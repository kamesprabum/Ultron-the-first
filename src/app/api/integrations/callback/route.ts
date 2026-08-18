import { NextRequest, NextResponse } from "next/server";
import { getIntegrationsStatus } from "@/services/integrations/composio";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const service = searchParams.get("service") || "service";
  const status = searchParams.get("status");
  const error = searchParams.get("error");
  const connectedAccountId = searchParams.get("connected_account_id");

  const origin = req.nextUrl.origin || "http://localhost:3000";
  const redirectUrl = new URL("/", origin);

  console.log(`[Composio Callback] Processing redirect for service=${service}, status=${status}, account=${connectedAccountId}`);

  if (status === "failed" || error) {
    redirectUrl.searchParams.set("integration", service);
    redirectUrl.searchParams.set("error", error || "authorization_failed");
    return NextResponse.redirect(redirectUrl);
  }

  // Verify status in Composio
  try {
    const integrationStatus = await getIntegrationsStatus();
    console.log("[Composio Callback] Live integration status:", integrationStatus);
  } catch (err) {
    console.error("[Composio Callback] Error verifying status:", err);
  }

  redirectUrl.searchParams.set("integration", service);
  redirectUrl.searchParams.set("connected", "1");

  return NextResponse.redirect(redirectUrl);
}
