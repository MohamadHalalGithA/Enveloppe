import { describe, expect, it } from "vitest";
import { advanceForLetter, afterSubmit, PROCESSES, placeNewCase, processView, statusForStage } from "@/lib/processes/engine";
import { getRegistry } from "@/lib/registry/load";

describe("process definitions", () => {
  it("loads three validated processes that cite registry sources", () => {
    const reg = getRegistry();
    expect(PROCESSES.map((p) => p.id)).toEqual(["CRA_REVIEW", "CRA_OBJECTION", "IRCC_BIOMETRICS"]);
    for (const p of PROCESSES) expect(reg.sources.has(p.sourceId), p.id).toBe(true);
  });

  it("places a new case by the letter that starts it", () => {
    expect(placeNewCase("CRA_REVIEW_DOCUMENT_REQUEST")).toEqual({ processId: "CRA_REVIEW", stageId: "DOCUMENTS_REQUESTED" });
    expect(placeNewCase("CRA_NOTICE_OF_REASSESSMENT")).toEqual({ processId: "CRA_OBJECTION", stageId: "OBJECTION_WINDOW_OPEN" });
    expect(placeNewCase("IRCC_BIOMETRICS_INSTRUCTION")).toEqual({ processId: "IRCC_BIOMETRICS", stageId: "BIOMETRICS_REQUESTED" });
    expect(placeNewCase("CRA_BALANCE_DUE")).toBeNull();
    expect(placeNewCase(null)).toBeNull();
  });

  it("only ever moves a case forward", () => {
    expect(advanceForLetter("CRA_REVIEW", "DOCUMENTS_REQUESTED", "CRA_BALANCE_DUE")).toBe("OUTCOME");
    expect(advanceForLetter("CRA_REVIEW", "OUTCOME", "CRA_REVIEW_DOCUMENT_REQUEST")).toBe("OUTCOME");
    expect(advanceForLetter("CRA_REVIEW", "UNDER_REVIEW", "IRCC_BIOMETRICS_INSTRUCTION")).toBe("UNDER_REVIEW");
  });

  it("moves to the waiting stage after the user submits", () => {
    expect(afterSubmit("CRA_REVIEW", "DOCUMENTS_REQUESTED")).toBe("UNDER_REVIEW");
    expect(afterSubmit("CRA_OBJECTION", "OBJECTION_WINDOW_OPEN")).toBe("APPEALS_REVIEW");
    expect(afterSubmit("CRA_REVIEW", "UNDER_REVIEW")).toBe("UNDER_REVIEW");
  });

  it("derives case status from the stage", () => {
    expect(statusForStage("CRA_REVIEW", "DOCUMENTS_REQUESTED")).toBe("ACTION_REQUIRED");
    expect(statusForStage("CRA_REVIEW", "UNDER_REVIEW")).toBe("WAITING_FOR_GOVERNMENT");
    expect(statusForStage("CRA_REVIEW", "OUTCOME")).toBe("CLOSED");
  });

  it("renders 'you are here' with done / current / todo stages and the official source", () => {
    const v = processView(getRegistry(), "CRA_REVIEW", "DOCUMENTS_REQUESTED")!;
    expect(v.stages.map((s) => s.state)).toEqual(["done", "current", "todo", "todo", "todo"]);
    expect(v.stages.find((s) => s.id === "UNDER_REVIEW")?.expectNext).toMatch(/45 days/);
    expect(v.sourceUrl).toContain("validating-your-eligibility");
    expect(processView(getRegistry(), "CRA_REVIEW", "NOPE")).toBeNull();
  });
});
