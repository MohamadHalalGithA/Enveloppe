# Enveloppe

Photograph a government letter. Enveloppe checks it against trusted government information and your existing
case history, tells you what needs to happen next, and tracks it until it's done.

**The LLM reads. The system decides.** Plan: [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) · Rules: [`CLAUDE.md`](CLAUDE.md)

## Run

```bash
npm install
cp .env.example .env.local      # fill in later; the mock UI needs nothing
npm run dev                     # http://localhost:3000/app
```

Database: local dev uses PGlite (real Postgres in-process, stored in `./.data`, no Docker) via
`DATABASE_URL=pglite:./.data/enveloppe`. Migrations in `db/migrations` apply automatically on first connect.
To use Docker Postgres instead: `npm run db:up` and `DATABASE_URL=postgres://enveloppe:enveloppe@localhost:5432/enveloppe`.

Auth0: the application must allow callback `http://localhost:3000/auth/callback`, logout `http://localhost:3000`
and web origin `http://localhost:3000`. `/app` requires login.

Checks: `npm run check` runs typecheck, lint, tests and build.

Gemini (needs `GEMINI_API_KEY` in `.env.local`; synthetic letters only):

```bash
npm run demo:letters                                   # render samples A–F to demo/letters/out/
npm run extract -- demo/letters/out/A_cra_ccb_review.png   # read one letter live, print the Extraction
npm run test:live                                      # live contract tests (real API calls)
```

## Layout

| Path | What |
|---|---|
| `lib/contracts/` | Shared Zod schemas + types (Extraction, VerificationItem, CaseMatch, DeadlineResult, ProcessView, ResponsePack, LetterResult, …). Change = team review |
| `demo/fixtures/` | Synthetic letters A (real CRA review), B (scam twin), C (reassessment deadline), E (low confidence) |
| `lib/mock/fixtures.ts` | Mock data source for the UI until the pipeline is wired |
| `lib/gemini/` | Letter reading: Gemini client, prompt, schema, Contract Guard |
| `data/registry/` + `lib/registry/` | Trust Registry: official phones, domains, payment and scam rules, forms, channels, each citing a checked source |
| `lib/verification/`, `lib/url/`, `lib/qr/` | Deterministic claim verification, URL analysis, server-side QR decoding |
| `lib/cases/`, `lib/deadlines/`, `lib/processes/` + `data/processes/` | Case Brain: threading + scam-in-context, deadline rules, process graphs, Response Pack, DB service |
| `lib/db/` | Drizzle schema, PGlite/Postgres client, user-scoped repository |
| `lib/auth/`, `proxy.ts` | Auth0 session, `requireUser()`, route protection |
| `components/`, `app/app/` | Civic Inbox and Analysis Result screens |
| `tests/` | Vitest |

All letters are synthetic. No real person's data.
