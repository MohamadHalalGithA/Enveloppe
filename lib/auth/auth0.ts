import { Auth0Client } from "@auth0/nextjs-auth0/server";

/**
 * Auth0 establishes identity; the app decides authorization (CLAUDE.md).
 * Session = encrypted HttpOnly cookie managed by the SDK; no tokens reach browser JavaScript.
 * Config (domain, client id/secret, cookie secret, base URL) comes from server-only env vars.
 */
export const auth0 = new Auth0Client({
  // SDK default adds `email` and `offline_access` (refresh tokens). We need neither:
  // identity is the `sub`, and there's no API to call on the user's behalf.
  authorizationParameters: { scope: "openid profile" },
  session: {
    rolling: true,
    inactivityDuration: 60 * 60 * 2, // 2 hours idle
    absoluteDuration: 60 * 60 * 12, // 12 hours max: government correspondence is sensitive
  },
});
