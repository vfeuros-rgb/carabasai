import { NextRequest, NextResponse } from "next/server";

export function GET(request: NextRequest) {
  const code = request.headers.get("x-vercel-ip-country") || "";
  let country = code;
  try {
    country = code ? new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code : "NOT DETECTED";
  } catch {
    country = code || "NOT DETECTED";
  }
  return NextResponse.json({ country });
}
