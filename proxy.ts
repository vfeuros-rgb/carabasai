import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const expectedPassword = process.env.SITE_ACCESS_PASSWORD;
  const expectedUsername = process.env.SITE_ACCESS_USERNAME ?? "carabasai";

  if (!expectedPassword) return NextResponse.next();

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Basic ")) {
    try {
      const decoded = atob(authorization.slice(6));
      const separator = decoded.indexOf(":");
      const username = decoded.slice(0, separator);
      const password = decoded.slice(separator + 1);

      if (separator > -1 && username === expectedUsername && password === expectedPassword) {
        return NextResponse.next();
      }
    } catch {
      // Invalid Basic Auth payload falls through to the password prompt.
    }
  }

  return new NextResponse("Carabasai Studio is temporarily private.", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Basic realm="Carabasai Studio", charset="UTF-8"',
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
