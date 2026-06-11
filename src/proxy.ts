import { NextResponse, type NextRequest } from "next/server";

// Edge-safe gate: only checks for the presence of an Auth.js session cookie and
// redirects unauthenticated users away from /portal. Fine-grained role checks
// (which dashboard, which data) happen in server layouts via getSessionUser().
const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const hasSession = SESSION_COOKIES.some((name) => req.cookies.has(name));

  if (pathname.startsWith("/portal") && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/portal/:path*"],
};
