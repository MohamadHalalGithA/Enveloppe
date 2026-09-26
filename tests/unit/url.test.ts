import { describe, expect, it } from "vitest";
import { getRegistry } from "@/lib/registry/load";
import { analyzeEmail, analyzeUrl, editDistance, looksLikeUrl } from "@/lib/url/analyze";

const reg = getRegistry();
const verdict = (u: string) => analyzeUrl(u, reg).verdict;

describe("analyzeUrl", () => {
  it.each([
    ["canada.ca", "OFFICIAL"],
    ["https://www.canada.ca/en/revenue-agency.html", "OFFICIAL"],
    ["canada.ca/cra-submit-documents", "OFFICIAL"],
    ["CANADA.CA.", "OFFICIAL"],
    ["https://cra-arc.gc.ca/e-services", "OFFICIAL"],
    ["ircc.canada.ca", "OFFICIAL"],
    ["(www.ontario.ca/page/serviceontario).", "OFFICIAL"],
    ["https://www.paysimply.ca/cra", "AUTHORIZED_THIRD_PARTY"],
  ])("%s → %s", (u, v) => expect(verdict(u)).toBe(v));

  it.each([
    ["https://cra-canada-verify.example/ccb?ref=8902", "LOOKALIKE"],
    ["canada.ca.evil.example", "LOOKALIKE"],
    ["https://canadda.ca", "LOOKALIKE"],
    ["https://my-gc-refund.com", "LOOKALIKE"],
    ["https://canada.ca@evil.example/login", "DISGUISED"],
    ["javascript:alert(1)", "UNSAFE_SCHEME"],
    ["data:text/html;base64,PHNjcmlwdD4=", "UNSAFE_SCHEME"],
    ["http://192.168.0.1/admin", "IP_ADDRESS"],
    ["http://2130706433/", "IP_ADDRESS"],
    ["https://xn--cnada-8qa.ca", "HOMOGRAPH"],
    ["https://bit.ly/3xYz", "SHORTENER"],
    ["https://example-payments.com", "NOT_OFFICIAL"],
    ["http://", "MALFORMED"],
  ])("%s → %s", (u, v) => expect(verdict(u)).toBe(v));

  it("does not flag legitimate businesses that merely contain a government word", () => {
    expect(verdict("https://www.canadapost-postescanada.ca")).toBe("NOT_OFFICIAL");
    expect(verdict("aircanada.com")).toBe("NOT_OFFICIAL");
  });

  it("reports what a lookalike imitates and what a disguised link pretends to be", () => {
    expect(analyzeUrl("https://cra-canada-verify.example", reg).imitates.sort()).toEqual(["canada", "cra"]);
    const d = analyzeUrl("https://canada.ca@evil.example", reg);
    expect(d.pretendsToBe).toBe("canada.ca");
    expect(d.registrableDomain).toBe("evil.example");
  });

  it("caps very long input", () => {
    expect(analyzeUrl(`https://${"a".repeat(5000)}.example`, reg).input.length).toBeLessThanOrEqual(2048);
  });
});

describe("analyzeEmail", () => {
  it("accepts Government of Canada addresses and flags free email services for federal agencies", () => {
    expect(analyzeEmail("someone@cra-arc.gc.ca", reg, "CRA").verdict).toBe("OFFICIAL");
    expect(analyzeEmail("cra.refunds@gmail.com", reg, "CRA").verdict).toBe("FREE_EMAIL");
    expect(analyzeEmail("mailto:ircc-desk@yahoo.ca", reg, "IRCC").verdict).toBe("FREE_EMAIL");
    expect(analyzeEmail("not-an-email", reg, "CRA").verdict).toBe("MALFORMED");
  });
});

describe("helpers", () => {
  it("computes edit distance with transpositions", () => {
    expect(editDistance("canada", "canada")).toBe(0);
    expect(editDistance("canada", "canadda")).toBe(1);
    expect(editDistance("canada", "cnaada")).toBe(1);
  });

  it("recognizes URL-like QR payloads", () => {
    expect(looksLikeUrl("https://x.example/a")).toBe(true);
    expect(looksLikeUrl("canada.ca/cra")).toBe(true);
    expect(looksLikeUrl("WIFI:S:home;T:WPA;P:secret;;")).toBe(true); // scheme-like → analyzed (and rejected) as a link
    expect(looksLikeUrl("Reference 2026-CCB-5831-4471")).toBe(false);
  });
});
