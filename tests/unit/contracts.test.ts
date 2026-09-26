import { describe, expect, it } from "vitest";
import { ExtractionZ, InboxZ, LetterResultZ, type LetterResult } from "@/lib/contracts";
import inbox from "@/demo/fixtures/inbox.json";
import extractionA from "@/demo/fixtures/letter-a-cra-review.extraction.json";
import extractionB from "@/demo/fixtures/letter-b-cra-twin.extraction.json";
import letterA from "@/demo/fixtures/letter-a-cra-review.result.json";
import letterB from "@/demo/fixtures/letter-b-cra-twin.result.json";
import letterC from "@/demo/fixtures/letter-c-cra-reassessment.result.json";
import letterE from "@/demo/fixtures/letter-e-low-confidence.result.json";
import { VERDICT_COPY } from "@/lib/ui/format";

const results: Record<string, LetterResult> = Object.fromEntries(
  Object.entries({ letterA, letterB, letterC, letterE }).map(([k, v]) => [k, LetterResultZ.parse(v)]),
);

describe("fixtures match the shared contracts", () => {
  it("parses every LetterResult, Extraction, and the Inbox", () => {
    expect(Object.keys(results)).toHaveLength(4);
    expect(() => ExtractionZ.parse(extractionA)).not.toThrow();
    expect(() => ExtractionZ.parse(extractionB)).not.toThrow();
    expect(() => InboxZ.parse(inbox)).not.toThrow();
  });

  it("inbox letters point at existing fixtures and cases", () => {
    const parsed = InboxZ.parse(inbox);
    const caseIds = new Set(parsed.cases.map((c) => c.id));
    const resultIds = new Set(Object.values(results).map((r) => r.id));
    for (const l of parsed.letters) {
      expect(resultIds.has(l.id)).toBe(true);
      if (l.caseId) expect(caseIds.has(l.caseId)).toBe(true);
    }
  });
});

describe("product invariants", () => {
  it("never labels a letter legitimate or a scam", () => {
    for (const v of Object.values(VERDICT_COPY)) {
      expect(`${v.title} ${v.body}`).not.toMatch(/legitimate|\bscam\b|fake/i);
    }
  });

  it("every registry-backed check cites a source and a verification date", () => {
    for (const r of Object.values(results)) {
      for (const item of r.items.filter((i) => i.evidenceType === "TRUST_REGISTRY")) {
        expect(item.sourceUrl, item.id).not.toBeNull();
        expect(item.verifiedOn, item.id).not.toBeNull();
      }
    }
  });

  it("boxes are well-formed (ymin < ymax, xmin < xmax)", () => {
    for (const r of Object.values(results)) {
      for (const item of r.items) {
        for (const [ymin, xmin, ymax, xmax] of item.highlight.boxes) {
          expect(ymin).toBeLessThan(ymax);
          expect(xmin).toBeLessThan(xmax);
        }
      }
    }
  });

  it("the twin letter surfaces registry and case-file contradictions", () => {
    const b = results.letterB;
    expect(b.verdict).toBe("CONTRADICTIONS_FOUND");
    const contradicted = b.items.filter((i) => i.status === "VERIFIED_CONTRADICTION").map((i) => i.claimType);
    expect(contradicted).toEqual(expect.arrayContaining(["reference", "phone", "qr", "payment"]));
    expect(b.caseMatch.decision).toBe("ASK_CONFLICT");
    expect(b.caseMatch.conflicts.map((c) => c.kind)).toContain("REFERENCE_MISMATCH");
    // The official channel is never the number printed in the letter.
    expect(b.officialContact.display).not.toBe("1-888-555-0147");
  });

  it("the reassessment deadline is rule-computed, not printed", () => {
    const c = results.letterC;
    expect(c.deadline.printed).toBeNull();
    expect(c.deadline.computed?.ruleId).toBe("CRA-OBJ-165-1");
    expect(c.deadline.effective).toBe("2026-10-08");
    expect(c.deadline.clockStartedOn).toBe("2026-07-10");
  });

  it("the low-confidence letter asks for confirmation and builds no response pack", () => {
    const e = results.letterE;
    expect(e.status).toBe("LOW_CONFIDENCE");
    expect(e.needsConfirmation.length).toBeGreaterThan(0);
    expect(e.responsePack).toBeNull();
  });
});
