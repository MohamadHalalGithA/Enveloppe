# Security & privacy review (feature freeze, 2026-09-27)

Checked against the guardrails in `CLAUDE.md`. "Test" = an automated test that fails if the control regresses.

| Area | Control | Evidence |
|---|---|---|
| Identity | Auth0 session (encrypted HttpOnly cookie, SameSite=Lax, Secure over HTTPS), PKCE + state + nonce; scope `openid profile` (no email, no refresh tokens); 12 h absolute / 2 h idle | e2e `security.spec.ts` (authorize URL, cookie flags) |
| Tokens | Never in the browser; the SDK's `/auth/access-token` route is disabled | e2e (404) |
| Authorization | Every private query scoped by the session user; other users' ids are 404 | unit `db.test.ts`, `api.test.ts`, `pages.test.tsx`; static check: all 14 handlers start from the session user |
| CSRF | Same-origin `Origin` required on every state-changing request | unit `api.test.ts` (403) |
| Input | Strict Zod bodies (unknown fields rejected), UUID route ids, JSON ≤ 16 KB, uploads ≤ 8 MB checked before reading (Next's proxy silently truncates > 10 MB) | unit `api.test.ts` (400/411/413/415) |
| Uploads | Magic-byte type check, 40 MP pixel cap, EXIF rotation baked in, re-encoded JPEG (EXIF/GPS stripped), owner-only `no-store` serving, 30-day expiry | unit `api.test.ts` (EXIF removed, 410 after expiry) |
| SSRF | No server-side fetching of letter-derived URLs at all; QR codes decoded, never opened | code (`lib/url/analyze.ts` is pure) |
| XSS | React escaping only (no `dangerouslySetInnerHTML`); CSP with per-request nonce + `strict-dynamic`, `object-src 'none'`, `base-uri 'self'` | e2e (CSP present, nonce changes; demo walk-through has no CSP violations) |
| Framing & headers | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, nosniff, strict referrer, Permissions-Policy, COOP; HSTS via Caddy / HTTPS | e2e `security.spec.ts` |
| Prompt injection | Letter text is data; model extracts only (no verdict field); schema + quote guard; instructions in letters flagged, never obeyed | live `gemini.live.test.ts` (Sample F) |
| AI output | Zod-validated; confidence can only be lowered; registry decides legitimacy | unit `gemini-*.test.ts`, `verification.test.ts` |
| Secrets | Server-only; no `NEXT_PUBLIC_` secrets; none in client bundles; `.env*` git- and docker-ignored; not baked into the image | scan of `.next/static` (clean); build works with no env present |
| Data minimization | References stored as HMAC + last 4 and masked in stored extractions; SIN redacted; no emails stored; spoken text built from verified facts and scrubbed; delete letter / case cascades | unit `db.test.ts`, `cases.test.ts`, `voice.test.ts` |
| Third parties | Gemini: image + fixed prompt, or sanitized script only (paid tier). ElevenLabs: scrubbed script only (key restricted to text-to-speech). Nothing else leaves | unit `voice.test.ts`, live `voice.live.test.ts` |
| Logging | Request id, route, status, error class, timing only | `lib/log.ts`; grep: no other `console.*` in app code |
| Abuse | Per-user rate limits: 10 uploads / 6 analyses / 10 voice / 60 changes per minute | unit `api.test.ts` (429) |
| Dependencies | `npm audit --omit=dev`: 0 vulnerabilities | audit at freeze |
| Demo | `/demo` is static synthetic data (no DB, no model calls); saved readings match only the exact sample files and are badged | unit `api.test.ts`, `demo.test.ts`; e2e |

## Known residual risks
- Rate limits are in memory (fine for the single instance; needs a shared store to scale out).
- CSP allows inline *styles* (highlight boxes are positioned with style attributes); scripts are nonce-only.
- ElevenLabs may retain request text under its policy (zero retention is an enterprise option); the text holds no identifiers.
- City of Ottawa registry entries are search-index sourced and still need a human check (`src-ottawa-311`).
- No malware scanning of uploads; mitigated by decoding and re-encoding every image.
- Account deletion is by letter/case today; full account removal is a manual database operation.
- The signed-in e2e flow (`tests/e2e/signed-in.spec.ts`) needs an Auth0 test user and the callback URL configured.
