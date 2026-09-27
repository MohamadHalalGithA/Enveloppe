import { NextResponse, type NextRequest } from "next/server";
import { auth0 } from "@/lib/auth/auth0";

/**
 * Next 16 proxy (formerly middleware). Mounts Auth0's /auth/* routes and keeps the session rolling.
 * This is a first gate, not the authorization layer: every private handler still calls requireUser()
 * and scopes its queries to that user.
 */
export async function proxy(request: NextRequest) {
  const authResponse = await auth0.middleware(request);
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/auth/")) return authResponse;

  const isApp = pathname === "/app" || pathname.startsWith("/app/");
  const isApi = pathname.startsWith("/api/");
  if (isApp || isApi) {
    const session = await auth0.getSession(request);
    if (!session) {
      if (isApi) {
        return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } }, { status: 401 });
      }
      // Relative path only: the SDK also re-validates returnTo against our own origin.
      const login = new URL("/auth/login", request.nextUrl.origin);
      login.searchParams.set("returnTo", pathname);
      return NextResponse.redirect(login);
    }
  }
  return authResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
