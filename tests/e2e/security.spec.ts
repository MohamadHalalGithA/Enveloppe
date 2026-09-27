import { expect, test } from "@playwright/test";

/** Security boundary as seen from outside: headers, sign-in gates, API refusals, input handling. */

test("every page carries a nonce CSP and the protective headers", async ({ request }) => {
  const a = await request.get("/demo");
  const b = await request.get("/demo");
  const csp = a.headers()["content-security-policy"];
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(b.headers()["content-security-policy"]).not.toBe(csp); // fresh nonce per request
  expect(a.headers()["x-frame-options"]).toBe("DENY");
  expect(a.headers()["x-content-type-options"]).toBe("nosniff");
  expect(a.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(a.headers()["permissions-policy"]).toContain("camera=()");
});

test("private pages require sign-in; the API refuses anonymous calls", async ({ request }) => {
  const app = await request.get("/app", { maxRedirects: 0 });
  expect(app.status()).toBe(307);
  expect(app.headers()["location"]).toBe("/auth/login?returnTo=%2Fapp");

  const letter = await request.get("/app/letters/00000000-0000-4000-8000-000000000001", { maxRedirects: 0 });
  expect(letter.status()).toBe(307);

  for (const [method, url] of [
    ["GET", "/api/inbox"],
    ["POST", "/api/letters"],
    ["GET", "/api/letters/00000000-0000-4000-8000-000000000001/image"],
    ["POST", "/api/letters/00000000-0000-4000-8000-000000000001/speech"],
    ["DELETE", "/api/cases/00000000-0000-4000-8000-000000000001"],
  ] as const) {
    const res = await request.fetch(url, { method });
    expect(res.status(), `${method} ${url}`).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } });
  }
});

test("sign-in goes to Auth0 with PKCE and only the scopes we need", async ({ request }) => {
  const res = await request.get("/auth/login?returnTo=/app", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const url = new URL(res.headers()["location"]);
  expect(url.hostname).toMatch(/\.auth0\.com$/);
  expect(url.searchParams.get("scope")).toBe("openid profile");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("state")).toBeTruthy();
  expect(url.searchParams.get("nonce")).toBeTruthy();
  expect(res.headers()["set-cookie"]).toMatch(/HttpOnly/i);
  // Tokens never reach browser JavaScript: the SDK's token route is disabled.
  expect((await request.get("/auth/access-token")).status()).toBe(404);
});

test("the public demo only serves its own synthetic data", async ({ request }) => {
  expect((await request.get("/demo/letters/not-a-uuid")).status()).toBe(404);
  expect((await request.get("/demo/letters/..%2F..%2Fpackage")).status()).toBe(404);
  expect((await request.get("/demo/letters/00000000-0000-4000-8000-000000000000")).status()).toBe(404);
  const audio = await request.get("/demo-audio/A-ar.mp3");
  expect(audio.status()).toBe(200);
  expect(audio.headers()["content-type"]).toBe("audio/mpeg");
});
