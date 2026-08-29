import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";

// Paths reachable without a browser session:
//  - the auth endpoints (you need them to log in / out / check session)
//  - the Home Assistant webhook, which authenticates itself with a per-user
//    token instead of a cookie (HA is not a browser).
function isPublic(pathname: string): boolean {
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname === "/api/ha-webhook") return true;
  // Chrome's install / "add to home screen" fetches these without cookies
  // (often from Google's WebAPK crawler). If they redirect to login, Android
  // falls back to a letter from the domain — "J" for jassie.us.
  if (pathname === "/manifest.webmanifest") return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/icon" || pathname.startsWith("/icon.")) return true;
  if (pathname === "/apple-icon" || pathname.startsWith("/apple-icon.")) return true;
  if (pathname === "/icon-192.png" || pathname === "/icon-512.png" || pathname === "/icon-monochrome.png") return true;
  if (pathname === "/icon-cluster-192.png" || pathname === "/icon-cluster-512.png") return true;
  if (pathname === "/mascot.png" || pathname === "/favicon.png") return true;
  return false;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const userId = await verifySessionToken(req.cookies.get(COOKIE_NAME)?.value);

  // The login page is reachable logged-out; if already logged in, skip it.
  if (pathname === "/login") {
    if (userId) {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (userId) return NextResponse.next();

  // API calls get a clean 401 so the client can react; pages redirect to login.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next static assets and the PWA icons / manifest (see isPublic).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|favicon.png|manifest.webmanifest|icon-192.png|icon-512.png|icon-monochrome.png|icon-cluster-192.png|icon-cluster-512.png|icon.png|apple-icon.png|mascot.png).*)",
  ],
};
