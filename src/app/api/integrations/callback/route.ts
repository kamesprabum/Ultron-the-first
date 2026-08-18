import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const service = req.nextUrl.searchParams.get("service") || "service";
  const origin = req.nextUrl.origin || "http://localhost:3000";

  // Redirect back to main page with query parameter indicating return
  const redirectUrl = new URL("/", origin);
  redirectUrl.searchParams.set("connected", service);

  return NextResponse.redirect(redirectUrl);
}
