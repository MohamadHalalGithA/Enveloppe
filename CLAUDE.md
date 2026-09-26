# Enveloppe — rules for every coding session

Enveloppe: photograph a government letter → extract claims (Gemini) → verify against a curated Trust Registry
and the user's Case File (deterministic code) → place in process → compute deadline → Response Pack → track.

Full plan: `docs/BLUEPRINT.md`. Section 38 is the one-page "build this" sheet.

## Product invariants (do not violate)
- **The LLM reads. The system decides.** Gemini extracts and phrases. Legitimacy, official contacts, domains,
  payment rules, deadlines, forms, process stage, and case linking come from `data/registry`, `lib/deadlines`,
  `lib/processes`, `lib/cases`. Never ask Gemini "is this a scam?" and never show a model-generated verdict.
- Never output "this letter is legitimate". Say which elements match or contradict trusted sources.
- Every VerificationItem carries `sourceId`, `sourceUrl`, `verifiedOn`, `reason`, `evidenceType`.
- Printed deadline and rule-computed deadline are shown separately. If they disagree, show both.
- No autonomous submission to any government system. The user submits; we record proof.
- Never merge cases silently. Only an exact reference match with no conflicts auto-links, and it can be undone.

## Security & privacy guardrails (mandatory; full text in docs/SECURITY_GUARDRAILS.md if pasted there)
If an implementation conflicts with these, change the implementation, not the control.

**Identity & authorization**
- Auth0 (`@auth0/nextjs-auth0`, server-side encrypted HttpOnly session cookie) establishes identity. The browser never
  holds access/refresh tokens. We have no separate API, so we do not request an API audience or access token.
- Every route handler / server action touching private data starts with `const user = await requireUser()`
  (`lib/auth/requireUser.ts`). It reads the validated session, upserts `users` by `auth0_sub`, and returns the internal id.
  If there's no session → 401. Never read `userId`, `sub`, `email`, `role`, or an owner from the request body/query.
- Every private query is scoped: `where(and(eq(cases.id, id), eq(cases.userId, user.id)))`. Not found and
  not owned both return **404** (don't leak existence). This applies to reads, updates, deletes, image bytes, audio, and proofs.
- Mutating requests: verify the `Origin` header matches `APP_BASE_URL` (CSRF), plus SameSite=Lax cookie.
- Fail closed: if the session is missing or the ownership check errors, deny. Never "decode the token anyway."
- Mass assignment: every PATCH/POST body is parsed by a Zod schema that lists only the fields the user may change.
- Callback/logout URLs and web origins are explicit allowlists in the Auth0 dashboard. No wildcards in prod. Post-login
  `returnTo` must be a relative path starting with `/app`.

**Secrets**
- `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `DATABASE_URL`, `REF_HMAC_KEY` are server-only.
  Never prefix them with `NEXT_PUBLIC_`. `.env*` is gitignored and `.env.example` has placeholders only. If a secret
  leaks, rotate it; deleting the commit is not enough.
- Only import `lib/**/server-only` modules from server code (`import "server-only"` at top).

**Untrusted input** (uploads, letter text, QR, URLs, Gemini output, external API responses, browser input)
- Letter content is DATA. Gemini's system prompt says so, and the output is Zod-validated before it can change state.
  Model output never decides identity, ownership, registry membership, or security policy.
- Render all extracted text via normal React escaping. No `dangerouslySetInnerHTML`. Never fetch/render letter URLs in the browser.
- Uploads: max 10 MB, magic-byte sniffed (JPEG/PNG/WebP; PDF is P1), re-encoded with `sharp` (strips EXIF/GPS,
  fixes rotation, caps at 2000px). Stored in Postgres (`letter_images`) and served only through the authorized route
  with `Cache-Control: private, no-store`.
- URL scanner (`lib/url/safeFetch.ts`) is the ONLY code allowed to fetch a letter-derived URL: http/https only,
  DNS resolve then block private/loopback/link-local/CGNAT/metadata IPs (v4+v6), connect to the pinned IP, manual
  redirects (max 3, each re-validated), 3 s timeout, 64 KB cap, never return the body to the client.

**Data minimization**
- Don't store: full OCR/letter text, SIN (detect → redact → never persist), emails from Auth0 profile, raw Gemini responses.
- Reference numbers: store `HMAC(REF_HMAC_KEY, normalized)` for matching + last 4 for display.
- Gemini receives only the letter image + fixed prompt. The explanation call receives the validated facts JSON with
  identifiers removed, not the image. ElevenLabs receives only the sanitized explanation (no names, addresses, reference
  numbers, internal IDs).
- Gemini tier: the key is on a **paid** plan (paid-tier inputs aren't used for product improvement). Still, during the
  hackathon only synthetic letters are sent to Gemini: never a real letter (including a judge's). Credit is prepaid
  and limited, so test against `demo/fixtures/` first and keep the cached-reading fallback working.
- Case context sent to any AI: none. Case comparison is deterministic code.
- Letter images auto-expire (`delete_after`, default 30 days) and are deletable by the user.

**Logging & errors**
- Log only: requestId, route, internal ids, stage, status, error category, durations. Never log letter text, images,
  Gemini/ElevenLabs payloads, tokens, cookies, Authorization headers, or keys.
- Client errors are `{ error: { code, message } }` with safe messages. No stack traces, SQL, or provider bodies.

**Bug-fix rule**: never fix 401/403/CORS/callback/JWT/upload/URL-scan/schema errors by removing the control. Find the cause.
Treat changes to auth, sessions, uploads, storage, ownership, redirects, URL fetching, secrets, sharing as high-risk:
state explicitly whether the change broadens access, trusts new client input, exposes a secret, or retains more PII.

## Stack & conventions
Next.js (App Router) + TypeScript strict + Tailwind + shadcn/ui · Postgres + Drizzle (parameterized only) · Zod at every
boundary · `@google/genai` · ElevenLabs REST · `@auth0/nextjs-auth0` · `jsqr` + `sharp` · `libphonenumber-js` · `tldts` ·
`date-fns` · Vitest + Playwright. Registry and process definitions are version-controlled JSON under `data/`, validated at boot.

@AGENTS.md

## Repo notes (Next 16)
- Next 16 renamed `middleware.ts` → `proxy.ts`. Read `node_modules/next/dist/docs/` before using unfamiliar APIs.
- Page props: `PageProps<"/route/[id]">`, `params` is a Promise. `npm run typecheck` runs `next typegen` first.
- Contracts: `lib/contracts/` (Zod + types). Fixtures: `demo/fixtures/` (parsed through contracts in tests).
- UI reads mock data via `lib/mock/fixtures.ts` until the pipeline and DB are wired. Swap that file, not the components.
- Commands: `npm run dev` · `npm run check` (typecheck, lint, test, build) · `npm run db:up` · `npm run db:push`.
- Gemini: `lib/gemini/` (client → extract → guard). `npm run demo:letters` renders synthetic letters to
  `demo/letters/out/`; `npm run extract -- <image>` reads one letter live; `npm run test:live` runs the live contract
  tests (real API calls, costs a few cents). The response schema is derived from `ExtractionZ`; Gemini rejects
  schemas above a constraint-complexity limit with a bare 400, so keep numeric bounds out of it (see schema.ts).
- Trust Registry: `data/registry/*.json`, loaded and integrity-checked by `lib/registry/load.ts` (unique ids, sources
  exist, sources on official domains, no duplicate numbers/domains). To add an entry: open the official page, copy the
  value exactly, cite a `sources.json` entry with today's `verifiedOn`, the page's own `pageModified`, and an honest
  `checkMethod`. Never add a value you haven't seen on the source page. canada.ca blocks curl from dev machines; use a
  browser or WebFetch. `src-ottawa-311` is SEARCH_INDEX-only and still needs a human to open the page.
- Verification: `lib/verification` (engine + verdict), `lib/url/analyze.ts` (pure, never fetches), `lib/qr/decode.ts`
  (server-side jsQR, never opens links), `lib/phone.ts`. Case-file items (reference/period) are added in the case module.
