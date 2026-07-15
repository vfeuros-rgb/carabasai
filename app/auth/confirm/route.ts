import { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

const allowedOtpTypes = new Set<EmailOtpType>([
  "email",
  "recovery",
  "invite",
  "email_change",
  "signup",
  "magiclink",
]);

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const rawType = request.nextUrl.searchParams.get("type");
  const requestedNext = request.nextUrl.searchParams.get("next");
  const next =
    requestedNext?.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : rawType === "recovery"
        ? "/account/reset-password"
        : "/account";
  const destination = new URL(next, request.url);

  if (!tokenHash || !rawType || !allowedOtpTypes.has(rawType as EmailOtpType)) {
    destination.searchParams.set("confirmation", "failed");
    return NextResponse.redirect(destination);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: rawType as EmailOtpType,
  });

  destination.searchParams.set("confirmation", error ? "failed" : "success");
  return NextResponse.redirect(destination);
}
