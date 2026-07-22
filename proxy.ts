import { NextResponse } from "next/server";

export function proxy() {
  // Account access is handled by Supabase. Browser-level Basic Auth was only a
  // temporary launch gate and repeatedly prompts mobile Safari for credentials.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
