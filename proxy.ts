import { NextResponse, type NextRequest } from "next/server";
import { auth0 } from "@/lib/auth/auth0";

/**
 * Next 16 proxy (formerly middleware):
 *  - mounts Auth0's /auth/* routes and keeps the session rolling,
 *  - first gate: anonymous /app → sign-in, anonymous /api → 401 (handlers still call requireUser()),
 *  - security headers on every response, including a per-request nonce CSP (scripts only run with the nonce).
 */

const isDev = process.env.NODE_ENV === "development";
const overHttps = (process.env.APP_BASE_URL ?? "").startsWith("https://");

function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes position the highlight boxes; scripts remain nonce-only.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(overHttps ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

function withSecurityHeaders<T extends Response>(res: T, csp: string): T {
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (overHttps) res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return res;
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  const authResponse = await auth0.middleware(request);
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/auth/")) return withSecurityHeaders(authResponse, csp);

  const isApp = pathname === "/app" || pathname.startsWith("/app/");
  const isApi = pathname.startsWith("/api/");
  if (isApp || isApi) {
    const session = await auth0.getSession(request);
    if (!session) {
      if (isApi) {
        return withSecurityHeaders(
          NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } }, { status: 401 }),
          csp,
        );
      }
      // Relative path only: the SDK also re-validates returnTo against our own origin.
      const login = new URL("/auth/login", request.nextUrl.origin);
      login.searchParams.set("returnTo", pathname);
      return withSecurityHeaders(NextResponse.redirect(login), csp);
    }
  }

  // Hand the nonce to rendering (Next applies it to its own scripts) and keep Auth0's rolling-session cookies.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const cookie of authResponse.cookies.getAll()) response.cookies.set(cookie);
  const cacheControl = authResponse.headers.get("cache-control");
  if (cacheControl) response.headers.set("cache-control", cacheControl);
  return withSecurityHeaders(response, csp);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
