import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { InboxZ, LetterResultZ } from "@/lib/contracts";
import { getDemoLetter } from "@/lib/demo/cache";
import { getRegistry } from "@/lib/registry/load";

const DIR = "demo/cache";

describe("public demo data (npm run demo:build)", () => {
  it("every built result and the inbox match the shared contracts", async () => {
    const files = await readdir(`${DIR}/results`);
    expect(files.length).toBe(5);
    for (const f of files) LetterResultZ.parse(JSON.parse(await readFile(`${DIR}/results/${f}`, "utf8")));
    const inbox = InboxZ.parse(JSON.parse(await readFile(`${DIR}/inbox.json`, "utf8")));
    expect(inbox.cases.map((c) => c.agencyId).sort()).toEqual(["CRA", "CRA", "IRCC"]);
  });

  it("the scam twin is caught and every cited source is a registry source", async () => {
    const reg = getRegistry();
    const urls = new Set([...reg.sources.values()].map((s) => s.url));
    const results = await Promise.all(
      (await readdir(`${DIR}/results`)).map(async (f) => LetterResultZ.parse(JSON.parse(await readFile(`${DIR}/results/${f}`, "utf8")))),
    );
    const twin = results.find((r) => r.verdict === "CONTRADICTIONS_FOUND");
    expect(twin?.caseMatch.decision).toBe("ASK_CONFLICT");
    for (const r of results) for (const i of r.items) if (i.sourceUrl) expect(urls.has(i.sourceUrl), i.sourceUrl).toBe(true);
  });

  it("only UUIDs can be looked up (no path traversal)", async () => {
    expect(await getDemoLetter("../../package")).toBeNull();
    expect(await getDemoLetter("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
