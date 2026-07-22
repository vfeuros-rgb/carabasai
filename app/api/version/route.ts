import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { version: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_URL || "development" },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
