import { NextResponse } from "next/server";
import { getIntegrationsStatus } from "@/services/integrations/composio";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getIntegrationsStatus();
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get integration status";
    return NextResponse.json(
      {
        gmail: { connected: false, email: null },
        calendar: { connected: false, email: null },
        configured: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
