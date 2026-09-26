import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/phone";

describe("normalizePhone", () => {
  it.each(["1-800-387-1193", "1 (800) 387-1193", "+1 800 387 1193", "800.387.1193"])("normalizes %s", (s) => {
    expect(normalizePhone(s)).toEqual({ e164: "+18003871193", fictional: false, shortCode: false });
  });

  it("keeps N11 short codes such as 3-1-1", () => {
    expect(normalizePhone("3-1-1")).toEqual({ e164: "311", fictional: false, shortCode: true });
  });

  it("detects the fictional 555-01xx range only", () => {
    expect(normalizePhone("1-888-555-0147").fictional).toBe(true);
    expect(normalizePhone("613-555-0199").fictional).toBe(true);
    expect(normalizePhone("613-555-0200").fictional).toBe(false);
    expect(normalizePhone("613-555-1234").fictional).toBe(false);
  });

  it("returns null for text that isn't a phone number", () => {
    expect(normalizePhone("call us").e164).toBeNull();
  });
});
