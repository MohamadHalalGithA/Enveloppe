import { describe, expect, it } from "vitest";
import { addDays, addYears, dayOfWeek, diffDays, holidayName, holidaysFor } from "@/lib/deadlines/calendar";
import { oldLetterNotice, wholeYears } from "@/lib/deadlines/age";
import { computeDeadline, distrustDeadline } from "@/lib/deadlines/engine";
import { getRegistry } from "@/lib/registry/load";
import { irccBiometricsLetter, letterA, letterB, noticeOfReassessment } from "../helpers/extractions";

const registry = getRegistry();
const today = "2026-09-27";
const run = (x: Parameters<typeof computeDeadline>[0], answers?: Record<string, string>) =>
  computeDeadline(x, { today, registry, answers });

describe("calendar", () => {
  it("does civil-date arithmetic without time zones", () => {
    expect(addDays("2026-07-10", 90)).toBe("2026-10-08");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(diffDays("2026-10-08", today)).toBe(11);
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
    expect(addYears("2024-04-30", 1)).toBe("2025-04-30");
    expect(dayOfWeek("2026-10-10")).toBe(6);
  });

  it("knows the federal and Ontario holidays for a year", () => {
    const h = holidaysFor(2026);
    expect(h.get("2026-02-16")).toBe("Family Day (Ontario)");
    expect(h.get("2026-04-03")).toBe("Good Friday");
    expect(h.get("2026-04-06")).toBe("Easter Monday");
    expect(h.get("2026-05-18")).toBe("Victoria Day");
    expect(h.get("2026-09-07")).toBe("Labour Day");
    expect(h.get("2026-09-30")).toBe("National Day for Truth and Reconciliation");
    expect(h.get("2026-10-12")).toBe("Thanksgiving Day");
    expect(holidaysFor(2018).get("2018-07-02")).toBe("Canada Day"); // July 1, 2018 was a Sunday
    expect(holidayName("2026-09-27")).toBe("a Sunday");
    expect(holidayName("2026-10-08")).toBeNull();
  });
});

describe("CRA objection rule (P148)", () => {
  it("Sample C: 90 days after the notice wins for an older tax year, and the clock started on the notice date", () => {
    const d = run(noticeOfReassessment({ issueDate: "2026-07-10", taxYear: 2023 }));
    expect(d.computed).toMatchObject({ date: "2026-10-08", ruleId: "CRA-OBJ-165-1", statutory: true });
    expect(d.computed?.sourceUrl).toContain("p148");
    expect(d.effective).toBe("2026-10-08");
    expect(d.daysRemaining).toBe(11);
    expect(d.status).toBe("SOON");
    expect(d.clockStartedOn).toBe("2026-07-10");
    expect(d.printed).toBeNull();
    expect(d.note).toMatch(/didn't start when you uploaded/);
    expect(d.computed?.assumptions.join(" ")).toMatch(/same if you or your spouse were self-employed/);
  });

  it("uses the later date: one year after the filing deadline for a recent tax year (a naive 90-day rule is wrong)", () => {
    const d = run(noticeOfReassessment({ issueDate: "2026-06-01", taxYear: 2025 }));
    expect(d.computed?.date).toBe("2027-04-30");
  });

  it("moves to June 15 when the user says they were self-employed", () => {
    const d = run(noticeOfReassessment({ issueDate: "2026-06-01", taxYear: 2025 }), { selfEmployed: "yes" });
    expect(d.computed?.date).toBe("2027-06-15");
  });

  it("notes a legal deadline that falls on a holiday but never silently shifts it", () => {
    const d = run(noticeOfReassessment({ issueDate: "2026-07-14", taxYear: 2023 }));
    expect(d.effective).toBe("2026-10-12");
    expect(d.note).toMatch(/Thanksgiving Day/);
    expect(d.note).toMatch(/Interpretation Act/);
  });

  it("once the objection deadline has passed, gives the last day to ask for an extension (P148: one year)", () => {
    const d = run(noticeOfReassessment({ issueDate: "2026-05-01", taxYear: 2023 }));
    expect(d.status).toBe("PASSED");
    expect(d.effective).toBe("2026-07-30");
    expect(d.note).toContain("You can still ask CRA for an extension of time to object");
    expect(d.note).toContain("no later than July 30, 2027");
  });

  it("an old notice: says the extension window has closed too, instead of offering it", () => {
    const d = run(noticeOfReassessment({ issueDate: "2016-04-18", taxYear: 2015 }));
    expect(d.status).toBe("PASSED");
    expect(d.effective).toBe("2017-04-30");
    expect(d.note).toContain("and so has the last day to ask CRA for an extension of time to object (April 30, 2018)");
    expect(d.note).not.toContain("You can still ask");
  });

  it("won't calculate from a date it isn't sure it read", () => {
    const x = noticeOfReassessment({ issueDate: "2026-07-10", taxYear: 2023 });
    x.issueDate.needsConfirmation = true;
    const d = run(x);
    expect(d.computed).toBeNull();
    expect(d.status).toBe("UNKNOWN");
    expect(d.note).toMatch(/couldn't read the letter's date/);
  });
});

describe("printed deadlines", () => {
  it("Sample A: acts on the printed date and says no legal rule overrides it", () => {
    const d = run(letterA());
    expect(d).toMatchObject({ effective: "2026-10-14", daysRemaining: 17, status: "OK", computed: null, mismatch: false });
    expect(d.printed?.sourceText).toBe("Please send the documents by October 14, 2026.");
    expect(d.note).toMatch(/printed in the letter/);
    expect(d.note).toMatch(/benefits may stop/);
  });

  it("resolves relative wording ('within 48 hours') from the letter date", () => {
    expect(run(letterB()).printed?.date).toBe("2026-09-23");
  });

  it("acts on the earlier date when printed and computed disagree", () => {
    const x = noticeOfReassessment({ issueDate: "2026-07-10", taxYear: 2023 });
    x.printedDeadlines = [{ value: "2026-09-30", sourceText: "by September 30, 2026", box: null, page: 1, confidence: "high", needsConfirmation: false, kind: "respond_by", relativeDays: null }];
    const d = run(x);
    expect(d.effective).toBe("2026-09-30");
    expect(d.mismatch).toBe(true);
  });

  it("distrusts every date from a letter with contradictions", () => {
    const d = distrustDeadline(run(letterB()), "CRA");
    expect(d).toMatchObject({ effective: null, daysRemaining: null, status: "UNKNOWN" });
    expect(d.printed?.date).toBe("2026-09-23");
    expect(d.note).toMatch(/Don't act on it/);
  });
});

describe("IRCC biometrics rule", () => {
  it("Sample D: 30 days, counted conservatively from the letter date, with a weekend note", () => {
    const d = run(irccBiometricsLetter("2026-09-10"));
    expect(d.computed).toMatchObject({ date: "2026-10-10", ruleId: "IRCC-BIO-30", statutory: false });
    expect(d.computed?.assumptions[0]).toMatch(/earliest the 30 days could start/);
    expect(d.effective).toBe("2026-10-10");
    expect(d.note).toMatch(/Saturday/);
  });
});

describe("old letters", () => {
  const oldNotice = () => run(noticeOfReassessment({ issueDate: "2016-04-18", taxYear: 2015 }));

  it("counts whole years between civil dates", () => {
    expect(wholeYears("2016-04-18", "2026-09-27")).toBe(10);
    expect(wholeYears("2025-09-28", "2026-09-27")).toBe(0);
    expect(wholeYears("2025-09-27", "2026-09-27")).toBe(1);
  });

  it("a 2016 notice: old, and its deadline has passed", () => {
    expect(oldLetterNotice(oldNotice())).toEqual({
      title: "This letter is old",
      body: "It's dated April 18, 2016 (10 years ago), and its deadline, April 30, 2017, has passed. If it only just reached you, that's unusual: check with the agency directly before you act on it.",
    });
  });

  it("a recent letter whose deadline has passed", () => {
    expect(oldLetterNotice(run(noticeOfReassessment({ issueDate: "2026-05-01", taxYear: 2023 })))).toEqual({
      title: "This letter's deadline has passed",
      body: "The deadline was July 30, 2026. The steps below say what you can still do.",
    });
  });

  it("an old letter with no deadline we can use (here: distrusted) is still called old", () => {
    const n = oldLetterNotice(distrustDeadline(oldNotice(), "CRA"));
    expect(n?.title).toBe("This letter is old");
    expect(n?.body).toMatch(/^It's dated April 18, 2016 \(10 years ago\)\. If it only just reached you/);
    const lastYear = { ...distrustDeadline(oldNotice(), "CRA"), clockStartedOn: "2025-06-01" };
    expect(oldLetterNotice(lastYear)?.body).toMatch(/\(over a year ago\)/);
  });

  it("stays quiet while a deadline is still ahead, however old the letter", () => {
    expect(oldLetterNotice(run(noticeOfReassessment({ issueDate: "2026-07-10", taxYear: 2023 })))).toBeNull();
    const d = run(noticeOfReassessment({ issueDate: "2026-07-10", taxYear: 2023 }));
    expect(oldLetterNotice({ ...d, clockStartedOn: "2024-01-15" })).toBeNull();
    expect(oldLetterNotice(run(letterA()))).toBeNull();
  });
});
