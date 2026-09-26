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

Database (needs Docker Desktop running):

```bash
npm run db:up                   # Postgres 16 on 127.0.0.1:5432
npm run db:push                 # apply lib/db/schema.ts
```

Checks: `npm run check` runs typecheck, lint, tests and build.

## Layout

| Path | What |
|---|---|
| `lib/contracts/` | Shared Zod schemas + types (Extraction, VerificationItem, CaseMatch, DeadlineResult, ProcessView, ResponsePack, LetterResult, …). Change = team review |
| `demo/fixtures/` | Synthetic letters A (real CRA review), B (scam twin), C (reassessment deadline), E (low confidence) |
| `lib/mock/fixtures.ts` | Mock data source for the UI until the pipeline is wired |
| `lib/db/` | Drizzle schema + lazy client |
| `components/`, `app/app/` | Civic Inbox and Analysis Result screens |
| `tests/` | Vitest |

All letters are synthetic. No real person's data.
