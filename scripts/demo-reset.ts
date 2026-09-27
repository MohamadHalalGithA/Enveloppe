/**
 * Resets the demo account before a rehearsal or the live demo:
 *   1. deletes all of the demo user's letters and cases (images, ledgers, tasks, clips cascade),
 *   2. seeds the "already in your inbox" case, Sample C (2023 reassessment), through the real pipeline
 *      using its saved reading (no Gemini call), exactly as if it had been uploaded earlier.
 *
 * Usage:  npm run demo:reset -- --sub "auth0|abc123"            (reset + seed)
 *         npm run demo:reset -- --sub "auth0|abc123" --no-seed  (reset only)
 * The sub is the demo user's user_id in Auth0 → User Management → Users.
 * A CLI on purpose: there is no reset endpoint, so there's nothing to abuse in production.
 * With a PGlite database, stop the app first (PGlite is single-process).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveUser } from "@/lib/auth/resolve";
import { decideCase, getInbox } from "@/lib/cases/service";
import { getDb } from "@/lib/db/client";
import { createLetter, deleteAllForUser, storeLetterImage } from "@/lib/db/repo";
import { PipelineError } from "@/lib/errors";
import { analyzeLetter } from "@/lib/pipeline/analyze";
import { cachedReadingFor } from "@/lib/pipeline/cached-reading";
import { todayInToronto } from "@/lib/time";
import { sanitizeUpload } from "@/lib/upload/sanitize";

try {
  process.loadEnvFile(".env.local");
} catch {
  // env may come from the shell (e.g. .env.production on the server)
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const sub = arg("--sub") ?? process.env.DEMO_AUTH0_SUB;
  if (!sub || !/^[\w-]+\|[\w.-]+$/.test(sub)) {
    throw new Error('Pass the demo user\'s Auth0 id: npm run demo:reset -- --sub "auth0|..."');
  }
  const refKey = process.env.REF_HMAC_KEY;
  if (!refKey) throw new Error("REF_HMAC_KEY missing");
  if (process.env.DATABASE_URL?.startsWith("pglite:")) console.log("PGlite database: make sure the app isn't running.");

  const db = await getDb();
  const user = await resolveUser(db, sub);
  const removed = await deleteAllForUser(db, user.id);
  console.log(`Removed ${removed.letters} letter(s) and ${removed.cases} case(s) for the demo user.`);

  if (!process.argv.includes("--no-seed")) {
    const image = await readFile(path.join(process.cwd(), "demo", "letters", "out", "C_cra_reassessment.png"));
    const clean = await sanitizeUpload(image);
    const { id } = await createLetter(db, user.id, clean.sha256);
    await storeLetterImage(db, user.id, id, clean, new Date(Date.now() + 30 * 86_400_000));
    const result = await analyzeLetter(db, user.id, id, {
      extract: async () => {
        throw new PipelineError("SERVICE_UNAVAILABLE"); // never called: offline mode uses the saved reading
      },
      cachedReading: cachedReadingFor,
      cachedMode: "offline",
      today: () => todayInToronto(),
      refKey,
    });
    await decideCase(db, user.id, id, { decision: "new" });
    console.log(`Seeded "${result.whatIsThis.docTypeLabel}" · deadline ${result.deadline.effective} (${result.deadline.daysRemaining} days left).`);
  }

  const inbox = await getInbox(db, user.id);
  console.log(`Demo inbox now: ${inbox.cases.map((c) => c.title).join(", ") || "empty"}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
