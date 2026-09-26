import { describe, expect, it } from "vitest";
import { formatCivilDate } from "@/lib/ui/format";

describe("formatCivilDate", () => {
  it("formats civil dates without shifting a day", () => {
    expect(formatCivilDate("2026-10-14")).toBe("October 14, 2026");
    expect(formatCivilDate("2028-02-29")).toBe("February 29, 2028");
    expect(formatCivilDate("2026-01-01")).toBe("January 1, 2026");
  });

  it("renders a dash for missing dates", () => {
    expect(formatCivilDate(null)).toBe("—");
  });
});
