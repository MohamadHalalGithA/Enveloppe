import { describe, expect, it } from "vitest";
import { LetterResultZ, type Extraction, type VerificationItem } from "@/lib/contracts";
import { assembleCaseFile } from "@/lib/cases/assemble";
import { caseTitle, programsMatch } from "@/lib/cases/labels";
import { maskReference, redactExtractionForStorage } from "@/lib/cases/mask";
import { digestReference, pickReference } from "@/lib/cases/reference";
import type { CaseCandidate } from "@/lib/cases/threading";
import type { QrFinding } from "@/lib/qr/decode";
import { getRegistry } from "@/lib/registry/load";
import { verifyExtraction } from "@/lib/verification";
import resultA from "@/demo/fixtures/letter-a-cra-review.result.json";
import resultB from "@/demo/fixtures/letter-b-cra-twin.result.json";
import { irccBiometricsLetter, letterA, letterB, noticeOfReassessment } from "../helpers/extractions";

const KEY = "test-key-".repeat(8);
const registry = getRegistry();
const today = "2026-09-27";
const scamQr: QrFinding[] = [{ box: [700, 700, 851, 896], page: 1, nearbyText: "Scan to verify your identity", decoded: "https://cra-canada-verify.example/ccb?ref=8902" }];

function assemble(x: Extraction, candidates: CaseCandidate[] = [], qr: QrFinding[] = []) {
  const picked = pickReference(x);
  const letterRef = picked && !picked.uncertain ? digestReference(picked.field.value!, KEY) : null;
  const masked = redactExtractionForStorage(x);
  const draft = assembleCaseFile({
    x: masked,
    registryItems: verifyExtraction(masked, { qr }).items,
    registry,
    today,
    candidates,
    letterRef,
    refUncertain: !!picked?.uncertain,
  });
  return { draft, letterRef };
}

function caseFrom(x: Extraction, id = "00000000-0000-4000-8000-0000000000ca"): CaseCandidate {
  const { draft, letterRef } = assemble(x);
  return {
    id,
    title: draft.newCaseTitle,
    agencyId: x.agency.value!,
    processId: draft.placement!.processId,
    stageId: draft.placement!.stageId,
    program: x.program.value,
    period: x.taxYear.value?.toString() ?? null,
    referenceHmac: letterRef?.hmac ?? null,
    referenceLast4: letterRef?.last4 ?? null,
    createdOn: today,
    latestLetterDate: x.issueDate.value,
    verifiedPhones: ["+18003871193"],
  };
}

const byType = (items: VerificationItem[], t: string) => items.find((i) => i.claimType === t);

describe("references", () => {
  it("digests normalized references with a secret key and keeps only the last 4", () => {
    const a = digestReference("2026-CCB-5831-4471", KEY)!;
    expect(digestReference("2026 ccb 5831 4471", KEY)).toEqual(a);
    expect(a.last4).toBe("4471");
    expect(a.hmac).not.toContain("5831");
    expect(digestReference("2026-CCB-5831-4471", "another-key-".repeat(4))!.hmac).not.toBe(a.hmac);
    expect(() => digestReference("x", "short")).toThrow();
  });

  it("masks references before anything is stored", () => {
    expect(maskReference("2026-CCB-5831-4471")).toBe("••••-•••-••••-4471");
    const stored = redactExtractionForStorage(letterA());
    expect(JSON.stringify(stored)).not.toContain("5831");
    expect(stored.identifiers[0].sourceText).toBe("Reference number: ••••-•••-••••-4471");
  });
});

describe("labels", () => {
  it("matches program names regardless of case, acronyms and filler words", () => {
    expect(programsMatch("Canada child benefit (CCB)", "Canada Child Benefit")).toBe(true);
    expect(programsMatch("Canada Child Benefit overpayment", "Canada child benefit")).toBe(true);
    expect(programsMatch("GST/HST credit", "Canada child benefit")).toBe(false);
  });

  it("titles cases by process", () => {
    expect(caseTitle(letterA(), "CRA_REVIEW", registry.agencies[0])).toBe("CRA: Canada Child Benefit review");
    expect(caseTitle(noticeOfReassessment({ issueDate: "2026-07-10", taxYear: 2023 }), "CRA_OBJECTION", registry.agencies[0])).toBe("CRA: 2023 reassessment");
  });
});

describe("twin-letter scenario (scam-in-context)", () => {
  const caseA = caseFrom(letterA());

  it("Sample A alone: consistent, new case, printed deadline, official channel", () => {
    const { draft } = assemble(letterA());
    expect(draft.verdict).toBe("CONSISTENT_WITH_TRUSTED_SOURCES");
    expect(draft.caseMatch.decision).toBe("NEW");
    expect(draft.status).toBe("SUCCESS");
    expect(draft.newCaseTitle).toBe("CRA: Canada Child Benefit review");
    expect(draft.process?.currentStageId).toBe("DOCUMENTS_REQUESTED");
    expect(byType(draft.items, "reference")).toMatchObject({ status: "UNVERIFIED", letterValue: "…4471", evidenceType: "CASE_FILE" });
    expect(draft.responsePack).toMatchObject({
      officialChannel: { registryId: "chan-cra-submit-docs" },
      officialContact: { registryId: "tel-cra-benefits", display: "1-800-387-1193" },
      action: { type: "submit_documents" },
    });
    expect(draft.responsePack!.requestedDocuments).toHaveLength(2);
  });

  it("Sample B against case A: conflicts with the case AND the registry", () => {
    const { draft } = assemble(letterB(), [caseA], scamQr);
    expect(draft.verdict).toBe("CONTRADICTIONS_FOUND");
    expect(draft.caseMatch.decision).toBe("ASK_CONFLICT");
    expect(draft.caseMatch.conflicts.map((c) => c.kind)).toEqual(["REFERENCE_MISMATCH", "PERIOD_MISMATCH", "CONTACT_MISMATCH"]);
    expect(byType(draft.items, "reference")).toMatchObject({ status: "VERIFIED_CONTRADICTION", strength: "STRONG", evidenceType: "CASE_FILE" });
    expect(byType(draft.items, "reference")!.reason).toMatch(/…4471/);
    expect(byType(draft.items, "tax_year")).toMatchObject({ status: "VERIFIED_CONTRADICTION", strength: "SOFT" });
    expect(draft.deadline.effective).toBeNull();
    expect(draft.process).toBeNull();
    expect(draft.responsePack).toMatchObject({ officialChannel: null, caution: "Don't use the contact details printed in this letter." });
    expect(draft.whatIsThis.agencyLabel).toMatch(/^Claims to be from/);
  });

  it("the same reference links automatically; a scammer reusing it does not", () => {
    expect(assemble(letterA(), [caseA]).draft.caseMatch).toMatchObject({ decision: "AUTO_LINK", linkedCaseId: caseA.id });
    const copycat = letterB();
    copycat.identifiers = letterA().identifiers;
    copycat.taxYear = letterA().taxYear;
    const { draft } = assemble(copycat, [caseA], scamQr);
    expect(draft.caseMatch.decision).not.toBe("AUTO_LINK");
    expect(draft.verdict).toBe("CONTRADICTIONS_FOUND");
  });

  it("a genuine but separate letter (official contacts, different reference) is a soft conflict, not a scam verdict", () => {
    const other = letterA();
    other.identifiers[0] = { ...other.identifiers[0], value: "2025-CCB-1234-9999", sourceText: "Reference number: 2025-CCB-1234-9999" };
    other.taxYear = { ...other.taxYear, value: 2024, sourceText: "Benefit year: 2024" };
    const { draft } = assemble(other, [caseA]);
    expect(draft.caseMatch.decision).toBe("ASK_CONFLICT");
    expect(byType(draft.items, "reference")).toMatchObject({ status: "VERIFIED_CONTRADICTION", strength: "SOFT" });
    expect(draft.verdict).toBe("PARTIALLY_VERIFIED");
  });

  it("an unclear reference asks the user instead of guessing", () => {
    const blurry = letterA();
    blurry.identifiers[0] = { ...blurry.identifiers[0], confidence: "low", needsConfirmation: true };
    const { draft } = assemble(blurry, [caseA]);
    expect(draft.caseMatch.decision).toBe("ASK");
    expect(byType(draft.items, "reference")?.status).toBe("NEEDS_USER_CONFIRMATION");
    expect(draft.status).toBe("NEEDS_CONFIRMATION");
    expect(draft.needsConfirmation.map((n) => n.label)).toContain("Reference number");
  });

  it("matches the UI fixtures' verdict, case decision and deadline", () => {
    const a = LetterResultZ.parse(resultA);
    const b = LetterResultZ.parse(resultB);
    const da = assemble(letterA()).draft;
    const db = assemble(letterB(), [caseA], scamQr).draft;
    expect([da.verdict, da.caseMatch.decision, da.deadline.effective]).toEqual([a.verdict, a.caseMatch.decision, a.deadline.effective]);
    expect([db.verdict, db.caseMatch.decision, db.deadline.effective]).toEqual([b.verdict, b.caseMatch.decision, b.deadline.effective]);
  });
});

describe("other processes", () => {
  it("Sample C: reassessment → objection process, statutory deadline, T400A and the file-an-objection channel", () => {
    const { draft } = assemble(noticeOfReassessment({ issueDate: "2026-07-10", taxYear: 2023 }));
    expect(draft.verdict).toBe("CONSISTENT_WITH_TRUSTED_SOURCES");
    expect(draft.process?.currentStageId).toBe("OBJECTION_WINDOW_OPEN");
    expect(draft.deadline.effective).toBe("2026-10-08");
    expect(draft.responsePack).toMatchObject({
      action: { type: "file_objection" },
      form: { registryId: "form-cra-t400a", code: "T400A" },
      officialChannel: { registryId: "chan-cra-file-objection" },
      officialContact: { registryId: "tel-cra-individual" },
    });
    expect(draft.newCaseTitle).toBe("CRA: 2023 reassessment");
  });

  it("Sample D: IRCC biometrics → booking channel and IRCC contact", () => {
    const { draft } = assemble(irccBiometricsLetter("2026-09-10"));
    expect(draft.process?.currentStageId).toBe("BIOMETRICS_REQUESTED");
    expect(draft.deadline.effective).toBe("2026-10-10");
    expect(draft.responsePack).toMatchObject({
      action: { type: "give_biometrics" },
      officialChannel: { registryId: "chan-ircc-biometrics" },
      officialContact: { registryId: "tel-ircc-client-support" },
    });
  });
});

describe("Response Pack invariant", () => {
  it("every contact, channel and form comes from the registry, never from the letter", () => {
    const ids = new Set([...registry.contacts, ...registry.channels, ...registry.forms].map((e) => e.id));
    const packs = [
      assemble(letterA()).draft,
      assemble(letterB(), [caseFrom(letterA())], scamQr).draft,
      assemble(noticeOfReassessment({ issueDate: "2026-07-10", taxYear: 2023 })).draft,
      assemble(irccBiometricsLetter("2026-09-10")).draft,
    ].map((d) => d.responsePack!);
    for (const p of packs) {
      expect(ids.has(p.officialContact.registryId)).toBe(true);
      if (p.officialChannel) expect(ids.has(p.officialChannel.registryId)).toBe(true);
      if (p.form) expect(ids.has(p.form.registryId)).toBe(true);
      expect(JSON.stringify(p)).not.toContain("555-0147");
    }
  });
});

describe("old letters (deadline passed)", () => {
  it("a 2016 notice: no objection 'by' a date that's gone, the step is flagged, nothing to submit", () => {
    const { draft } = assemble(noticeOfReassessment({ issueDate: "2016-04-18", taxYear: 2015 }));
    expect(draft.verdict).toBe("CONSISTENT_WITH_TRUSTED_SOURCES");
    expect(draft.deadline.status).toBe("PASSED");
    const pack = draft.responsePack!;
    expect(pack.summary).toBe(
      "The deadline to object to this notice of reassessment was April 30, 2017, and the last day to ask for more time was April 30, 2018. If you still disagree with it, ask CRA what you can do.",
    );
    expect(pack.action).toEqual({ type: "call", label: "Ask CRA what you can still do" });
    expect(pack).toMatchObject({ officialChannel: null, form: null, officialContact: { registryId: "tel-cra-individual" } });
    expect(draft.whatIsThis.explanation.en).not.toMatch(/you can file an objection/);
    expect(draft.process?.stages.find((s) => s.state === "current")).toMatchObject({
      id: "OBJECTION_WINDOW_OPEN",
      alert: "The deadline for this step was April 30, 2017. It has passed.",
    });
  });

  it("an objection deadline missed within the last year: ask for more time, as P148 describes", () => {
    const { draft } = assemble(noticeOfReassessment({ issueDate: "2026-05-01", taxYear: 2023 }));
    const pack = draft.responsePack!;
    expect(pack.summary).toBe(
      "The deadline to object to this notice of reassessment was July 30, 2026. If you disagree with it, you can still ask CRA for more time to object, until July 30, 2027.",
    );
    expect(pack.action).toEqual({ type: "file_objection", label: "Decide whether to ask for more time to object" });
    expect(pack.steps[1]).toBe(
      "If you disagree, ask for more time in your CRA account, or write to CRA's Chief of Appeals. Explain why you didn't object on time, and include your objection.",
    );
    expect(pack).toMatchObject({ form: { code: "T400A" }, officialChannel: { registryId: "chan-cra-file-objection" } });
  });

  it("a review letter past its date: call first, then the usual steps", () => {
    const x = letterA();
    x.printedDeadlines = x.printedDeadlines.map((d) => ({ ...d, value: "2026-09-01", sourceText: "by September 1, 2026" }));
    const pack = assemble(x).draft.responsePack!;
    expect(pack.summary).toBe("CRA asked for documents by September 1, 2026. That date has passed, so call CRA as soon as you can.");
    expect(pack.steps.slice(0, 2)).toEqual([
      "Call CRA at the official number above and ask whether you can still send the documents.",
      "Gather the documents in the checklist.",
    ]);
    expect(pack.action?.type).toBe("submit_documents");
  });

  it("biometrics past the 30 days: contact IRCC, don't book as if nothing happened", () => {
    const pack = assemble(irccBiometricsLetter("2026-08-01")).draft.responsePack!;
    expect(pack.summary).toBe("The deadline to give your biometrics was August 31, 2026. That date has passed, so contact IRCC as soon as you can.");
    expect(pack.steps[0]).toBe("Contact IRCC through its web form and ask what to do now.");
  });

  it("a letter whose deadline is still ahead is unchanged", () => {
    const { draft } = assemble(noticeOfReassessment({ issueDate: "2026-07-10", taxYear: 2023 }));
    expect(draft.responsePack?.summary).toBe(
      "If you disagree with this notice of reassessment, you can file an objection by October 8, 2026. If you agree, you don't need to do anything.",
    );
    expect(draft.process?.stages.some((s) => s.alert)).toBe(false);
  });
});
