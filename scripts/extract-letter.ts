/**
 * Dev tool: run the real extraction on one image and print the guarded Extraction.
 * Usage: npm run extract -- demo/letters/out/A_cra_ccb_review.png
 * Only synthetic letters: the hackathon uses the free Gemini tier (see CLAUDE.md).
 */
import { readFile } from "node:fs/promises";
import { extractFromImage } from "@/lib/gemini/client";

try {
  process.loadEnvFile(".env.local");
} catch {}

const file = process.argv[2];
if (!file) {
  console.error("usage: npm run extract -- <image>");
  process.exit(1);
}
const t0 = Date.now();
readFile(file)
  .then(extractFromImage)
  .then((r) => {
    console.log(JSON.stringify(r.extraction, null, 2));
    console.error(`model=${r.modelId} attempts=${JSON.stringify(r.attempts)} ms=${Date.now() - t0}`);
  })
  .catch((e) => {
    console.error(`FAILED ${e.code ?? e.name}: ${e.message}`);
    process.exit(1);
  });
