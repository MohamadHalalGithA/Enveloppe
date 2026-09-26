import { describe, expect, it } from "vitest";
import { buildRegistry, getRegistry, RegistryError, type RawRegistry } from "@/lib/registry/load";
import { matchDomain, officialContactFor, scamRulesFor } from "@/lib/registry/lookup";
import { normalizePhone } from "@/lib/phone";
import agencies from "@/data/registry/agencies.json";
import channels from "@/data/registry/channels.json";
import contacts from "@/data/registry/contacts.json";
import domains from "@/data/registry/domains.json";
import forms from "@/data/registry/forms.json";
import payments from "@/data/registry/payments.json";
import scamRules from "@/data/registry/scam-rules.json";
import sources from "@/data/registry/sources.json";

const raw = (): RawRegistry =>
  structuredClone({ sources, agencies, contacts, domains, payments, scamRules, forms, channels });

describe("Trust Registry data", () => {
  it("loads and passes every integrity check", () => {
    const reg = getRegistry();
    expect(reg.agencies.map((a) => a.code).sort()).toEqual(["CITY_OF_OTTAWA", "CRA", "IRCC", "SERVICEONTARIO"]);
    expect(reg.contacts.length).toBeGreaterThanOrEqual(15);
  });

  it("stores every phone number in canonical E.164 form", () => {
    for (const c of getRegistry().contacts) {
      expect(normalizePhone(c.display).e164, c.id).toBe(c.e164);
    }
  });

  it("records how and when each source was checked, and never dates a check in the future", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const s of getRegistry().sources.values()) {
      expect(s.verifiedOn <= today, s.id).toBe(true);
      if (s.pageModified) expect(s.pageModified <= s.verifiedOn, s.id).toBe(true);
    }
  });

  it("flags sources that still need a human check", () => {
    const pending = [...getRegistry().sources.values()].filter((s) => s.checkMethod === "SEARCH_INDEX");
    expect(pending.map((s) => s.id)).toEqual(["src-ottawa-311"]);
  });
});

describe("buildRegistry rejects bad data", () => {
  it("rejects an entry citing a missing source", () => {
    const r = raw();
    (r.contacts as { sourceId: string }[])[0].sourceId = "src-missing";
    expect(() => buildRegistry(r)).toThrow(RegistryError);
  });

  it("rejects duplicate phone numbers and duplicate ids", () => {
    const r = raw();
    (r.contacts as object[]).push({ ...(r.contacts as object[])[0], id: "tel-dup" });
    expect(() => buildRegistry(r)).toThrow(/duplicate phone/);
    const r2 = raw();
    (r2.forms as { id: string }[])[0].id = "tel-cra-benefits";
    expect(() => buildRegistry(r2)).toThrow(/duplicate id/);
  });

  it("rejects sources that aren't on an official government domain", () => {
    const r = raw();
    (r.sources as { url: string }[])[0].url = "https://cra-help.example/contact";
    expect(() => buildRegistry(r)).toThrow(/official government domain/);
  });

  it("rejects malformed entries", () => {
    const r = raw();
    (r.payments as { verdict: string }[])[0].verdict = "MAYBE";
    expect(() => buildRegistry(r)).toThrow(RegistryError);
  });
});

describe("lookups", () => {
  const reg = getRegistry();

  it("matches official domains and their subdomains only", () => {
    expect(matchDomain(reg, "canada.ca")?.id).toBe("dom-canada-ca");
    expect(matchDomain(reg, "www.canada.ca")?.id).toBe("dom-canada-ca");
    expect(matchDomain(reg, "cra-arc.gc.ca")?.id).toBe("dom-gc-ca");
    expect(matchDomain(reg, "services.ontario.ca")?.id).toBe("dom-ontario-ca");
    expect(matchDomain(reg, "notcanada.ca")).toBeUndefined();
    expect(matchDomain(reg, "canada.ca.evil.example")).toBeUndefined();
  });

  it("picks the official contact that fits the letter", () => {
    expect(officialContactFor(reg, "CRA", { program: "Canada Child Benefit" })?.id).toBe("tel-cra-benefits");
    expect(officialContactFor(reg, "CRA", { docType: "CRA_NOTICE_OF_REASSESSMENT" })?.id).toBe("tel-cra-individual");
    expect(officialContactFor(reg, "IRCC", { docType: "IRCC_BIOMETRICS_INSTRUCTION" })?.id).toBe("tel-ircc-client-support");
    expect(officialContactFor(reg, "UNKNOWN", {})).toBeUndefined();
  });

  it("applies Government-of-Canada-wide rules to federal agencies only", () => {
    expect(scamRulesFor(reg, "CRA", "free_email_domain")).toHaveLength(1);
    expect(scamRulesFor(reg, "IRCC", "free_email_domain")).toHaveLength(1);
    expect(scamRulesFor(reg, "CITY_OF_OTTAWA", "free_email_domain")).toHaveLength(0);
  });
});
