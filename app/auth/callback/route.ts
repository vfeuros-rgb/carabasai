import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const requestedNext = request.nextUrl.searchParams.get("next");
  const next = requestedNext?.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/account";
  const destination = new URL(next, request.url);

  if (!code) {
    destination.searchParams.set("confirmation", "failed");
    return NextResponse.redirect(destination);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  destination.searchParams.set("confirmation", error ? "failed" : "success");
  return NextResponse.redirect(destination);
}
