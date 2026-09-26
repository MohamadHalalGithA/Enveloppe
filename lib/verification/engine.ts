import type {
  AgencyCode,
  AgencyEntry,
  Box,
  ClaimType,
  Extraction,
  Field,
  PaymentMethod,
  VerificationItem,
  VStatus,
  VStrength,
} from "@/lib/contracts";
import { normalizePhone } from "@/lib/phone";
import type { QrFinding } from "@/lib/qr/decode";
import type { Registry } from "@/lib/registry/load";
import {
  agencyEntry,
  findContact,
  findForm,
  governmentDomainsFor,
  officialContactFor,
  paymentRule,
  scamRulesFor,
  sourceOf,
} from "@/lib/registry/lookup";
import { analyzeEmail, analyzeUrl, looksLikeUrl, type UrlAnalysis } from "@/lib/url/analyze";

/**
 * Verification Engine (Blueprint Part 8): claim → normalize → rule → registry lookup → evidence.
 * Deterministic. No model output is trusted as a fact about legitimacy; the model only supplied the claims.
 * Case-file checks (reference / period vs the user's cases) are added by the case module and merged via sortItems.
 */

export interface VerifyContext {
  registry: Registry;
  /** Server-decoded QR codes (lib/qr/decode.ts). */
  qr: QrFinding[];
}

type Draft = Omit<VerificationItem, "id" | "sourceUrl" | "verifiedOn" | "officialAlternative" | "highlight"> & {
  officialAlternative?: VerificationItem["officialAlternative"];
  boxes?: (Box | null)[];
  quote?: string | null;
  page?: number;
  lowConfidence?: boolean;
};

const METHOD_LABEL: Record<PaymentMethod, string> = {
  interac_etransfer: "Interac e-Transfer",
  gift_card: "gift cards",
  crypto: "cryptocurrency",
  prepaid_card: "prepaid cards",
  wire: "wire transfer",
  online_banking: "online banking",
  debit_my_payment: "debit card (My Payment)",
  credit_card_third_party: "credit card",
  pre_authorized_debit: "pre-authorized debit",
  cheque: "cheque",
  in_person: "in-person payment",
  other: "this payment method",
};

const NEEDS_CONFIRMATION_REASON =
  "We couldn't read this clearly, so we haven't checked it. Please confirm it against your letter.";

export function verifyClaims(x: Extraction, ctx: VerifyContext): VerificationItem[] {
  const reg = ctx.registry;
  const agencyCode: AgencyCode | null = x.agency.value;
  const agency = agencyEntry(reg, agencyCode);
  const drafts: Draft[] = [];

  const fieldDraft = <T>(f: Field<T>, base: Omit<Draft, "boxes" | "quote" | "page" | "lowConfidence">): Draft => {
    const lowConfidence = f.confidence === "low" || f.needsConfirmation;
    if (f.needsConfirmation) {
      return {
        ...base,
        status: "NEEDS_USER_CONFIRMATION",
        strength: "NONE",
        reason: NEEDS_CONFIRMATION_REASON,
        officialAlternative: base.officialAlternative,
        boxes: [f.box],
        quote: f.sourceText,
        page: f.page,
        lowConfidence,
      };
    }
    return { ...base, boxes: [f.box], quote: f.sourceText, page: f.page, lowConfidence };
  };

  const official = agency
    ? officialContactFor(reg, agency.code, { program: x.program.value, docType: x.documentType.value, title: x.documentType.rawTitle })
    : undefined;
  const phoneAlternative = official
    ? { label: official.label, value: official.display, registryId: official.id }
    : undefined;
  const webAlternative = agency ? websiteAlternative(agency) : undefined;

  // ---- agency ----
  if (x.agency.value !== null) {
    if (agency) {
      drafts.push(
        fieldDraft(x.agency, {
          claimType: "agency",
          letterValue: x.agency.claimedName ?? agency.name,
          status: "VERIFIED_MATCH",
          strength: "SOFT",
          evidenceType: "TRUST_REGISTRY",
          reason: `${agency.shortName} is an agency we track. Anyone can print an agency name, so this alone proves little.`,
          sourceId: agency.sourceId,
        }),
      );
    } else {
      drafts.push(
        fieldDraft(x.agency, {
          claimType: "agency",
          letterValue: x.agency.claimedName ?? "Unknown sender",
          status: "UNVERIFIED",
          strength: "NONE",
          evidenceType: "NONE",
          reason:
            x.agency.value === "NON_GOVERNMENT"
              ? "This doesn't look like it's from a government agency."
              : "We don't have trusted information for this sender yet.",
          sourceId: null,
        }),
      );
    }
  }

  // ---- phones ----
  for (const f of x.phones) {
    if (!f.value) continue;
    const p = normalizePhone(f.value);
    const known = p.e164 ? findContact(reg, p.e164) : undefined;
    const base = { claimType: "phone" as const, letterValue: f.value, evidenceType: "TRUST_REGISTRY" as const };
    if (known && agency && known.agencyId === agency.code) {
      drafts.push(
        fieldDraft(f, {
          ...base,
          status: "VERIFIED_MATCH",
          strength: "STRONG",
          reason: `Matches ${agency.shortName}'s published number: ${known.label}.`,
          sourceId: known.sourceId,
        }),
      );
    } else if (known) {
      const owner = agencyEntry(reg, known.agencyId);
      drafts.push(
        fieldDraft(f, {
          ...base,
          status: "UNVERIFIED",
          strength: "SOFT",
          reason: `This is an official number for ${owner?.shortName ?? known.agencyId} (${known.label}), not for ${agency?.shortName ?? "the sender this letter names"}.`,
          sourceId: known.sourceId,
          officialAlternative: phoneAlternative,
        }),
      );
    } else if (p.fictional) {
      drafts.push(
        fieldDraft(f, {
          ...base,
          status: "VERIFIED_CONTRADICTION",
          strength: "HARD",
          reason: `This isn't ${agency ? `a ${agency.shortName}` : "an official"} phone number: it's not on ${agency ? `${agency.shortName}'s` : "any"} official contact list, and numbers in the 555-01xx range aren't assigned to real services.`,
          sourceId: official?.sourceId ?? null,
          officialAlternative: phoneAlternative,
        }),
      );
    } else if (agency) {
      drafts.push(
        fieldDraft(f, {
          ...base,
          status: "UNVERIFIED",
          strength: "NONE",
          reason: `This number isn't on ${agency.shortName}'s official contact list. That doesn't mean it's fake, but use the official number to be safe.`,
          sourceId: official?.sourceId ?? null,
          officialAlternative: phoneAlternative,
        }),
      );
    } else {
      drafts.push(
        fieldDraft(f, {
          ...base,
          evidenceType: "NONE",
          status: "UNVERIFIED",
          strength: "NONE",
          reason: "We don't have an official contact list for this sender.",
          sourceId: null,
        }),
      );
    }
  }

  // ---- websites and emails ----
  for (const f of x.urls) {
    if (!f.value) continue;
    drafts.push(fieldDraft(f, linkDraft("url", f.value, analyzeUrl(f.value, reg), reg, agency, webAlternative, "This link")));
  }
  for (const f of x.emails) {
    if (!f.value) continue;
    const a = analyzeEmail(f.value, reg, agencyCode ?? "UNKNOWN");
    drafts.push(fieldDraft(f, linkDraft("email", f.value, a, reg, agency, webAlternative, "This email address")));
  }

  // ---- QR codes (decoded server-side, never opened) ----
  for (const q of ctx.qr) {
    const common = { boxes: [q.box], quote: q.nearbyText, page: q.page, lowConfidence: false };
    if (q.decoded === null) {
      drafts.push({
        claimType: "qr",
        letterValue: "Unreadable QR code",
        status: "UNVERIFIED",
        strength: "NONE",
        evidenceType: "NONE",
        reason: "We found a QR code but couldn't read it. Don't scan it; use the official website instead.",
        sourceId: null,
        officialAlternative: webAlternative,
        ...common,
      });
    } else if (!looksLikeUrl(q.decoded)) {
      drafts.push({
        claimType: "qr",
        letterValue: q.decoded.slice(0, 120),
        status: "UNVERIFIED",
        strength: "NONE",
        evidenceType: "NONE",
        reason: "The QR code contains text, not a web link.",
        sourceId: null,
        ...common,
      });
    } else {
      drafts.push({
        ...linkDraft("qr", q.decoded, analyzeUrl(q.decoded, reg), reg, agency, webAlternative, "The QR code"),
        ...common,
      });
    }
  }

  // ---- payment requests ----
  for (const f of x.paymentRequests) {
    drafts.push(fieldDraft(f, paymentDraft(f.method, f.sourceText ?? "", reg, agency)));
  }

  // ---- forms ----
  for (const f of x.formNumbers) {
    if (!f.value) continue;
    const form = agency ? findForm(reg, agency.code, f.value) : undefined;
    drafts.push(
      fieldDraft(
        f,
        form
          ? {
              claimType: "form",
              letterValue: f.value,
              status: "VERIFIED_MATCH",
              strength: "STRONG",
              evidenceType: "TRUST_REGISTRY",
              reason: `${form.code} (${form.name}) is an official ${agency!.shortName} form.`,
              sourceId: form.sourceId,
            }
          : {
              claimType: "form",
              letterValue: f.value,
              status: "UNVERIFIED",
              strength: "NONE",
              evidenceType: "NONE",
              reason: "This form isn't in our list, so we can't confirm it.",
              sourceId: null,
            },
      ),
    );
  }

  // ---- pressure language and threats ----
  drafts.push(...riskDrafts(x, reg, agency));

  // ---- text addressed to software ----
  if (x.embeddedInstructions.length) {
    drafts.push({
      claimType: "embedded_instruction",
      letterValue: "Text addressed to automated systems",
      status: "VERIFIED_CONTRADICTION",
      strength: "SOFT",
      evidenceType: "NONE",
      reason: "This letter contains text addressed to software. Real government letters don't do this. Enveloppe ignored it.",
      sourceId: null,
      boxes: x.embeddedInstructions.map((e) => e.box),
      quote: x.embeddedInstructions[0].sourceText,
      page: 1,
      lowConfidence: false,
    });
  }

  return sortItems(drafts.map((d, i) => finalize(d, i, reg)));
}

function websiteAlternative(agency: AgencyEntry): VerificationItem["officialAlternative"] {
  return {
    label: `Official ${agency.shortName} website`,
    value: agency.homepage.replace(/^https:\/\/(www\.)?/, ""),
    registryId: agency.id,
  };
}

function linkDraft(
  claimType: Extract<ClaimType, "url" | "email" | "qr">,
  value: string,
  a: UrlAnalysis,
  reg: Registry,
  agency: AgencyEntry | undefined,
  webAlternative: VerificationItem["officialAlternative"] | undefined,
  subject: string,
): Draft {
  const shown = a.registrableDomain ?? a.host ?? value;
  const govSource = agency ? governmentDomainsFor(reg, agency.code)[0]?.sourceId ?? null : null;
  const base = {
    claimType,
    letterValue: claimType === "qr" ? shown : value,
    evidenceType: "DOMAIN_ANALYSIS" as const,
  };
  const leads = claimType === "qr" ? "leads to" : "goes to";
  const contradiction = (strength: VStrength, reason: string): Draft => ({
    ...base,
    status: "VERIFIED_CONTRADICTION",
    strength,
    reason,
    sourceId: govSource,
    officialAlternative: webAlternative,
  });

  switch (a.verdict) {
    case "OFFICIAL":
      return {
        ...base,
        status: "VERIFIED_MATCH",
        strength: "STRONG",
        reason: `${subject} ${leads} ${shown}, an official ${a.domainEntry!.ownerLabel} domain.`,
        sourceId: a.domainEntry!.sourceId,
      };
    case "AUTHORIZED_THIRD_PARTY":
      return {
        ...base,
        status: "VERIFIED_MATCH",
        strength: "STRONG",
        reason: `${subject} ${leads} ${shown}: ${a.domainEntry!.purpose ?? "a service the agency lists"}. It isn't ${agency?.shortName ?? "the agency"} itself.`,
        sourceId: a.domainEntry!.sourceId,
      };
    case "LOOKALIKE":
      return contradiction(
        "HARD",
        `${subject} ${leads} ${shown}, which isn't a government domain. Its name imitates ${a.imitates.map((w) => `"${w}"`).join(" and ")}.`,
      );
    case "DISGUISED":
      return contradiction("HARD", `${subject} is disguised: it starts with "${a.pretendsToBe}" but actually ${leads} ${shown}.`);
    case "IP_ADDRESS":
      return contradiction("HARD", `${subject} ${leads} a bare numeric internet address, not a government website.`);
    case "HOMOGRAPH":
      return contradiction("HARD", `${subject} uses look-alike characters from other alphabets to imitate a real address.`);
    case "UNSAFE_SCHEME":
      return contradiction("HARD", `${subject} uses an unsafe link type ("${a.scheme}:"). Don't open it.`);
    case "FREE_EMAIL": {
      const rule = agency ? scamRulesFor(reg, agency.code, "free_email_domain")[0] : undefined;
      return {
        ...contradiction(
          rule ? "HARD" : "STRONG",
          `${subject} uses a free email service (${shown}). ${rule?.statement ?? "Government agencies don't use free email services."}`,
        ),
        evidenceType: "TRUST_REGISTRY",
        sourceId: rule?.sourceId ?? govSource,
      };
    }
    case "NOT_OFFICIAL":
      return agency
        ? contradiction("STRONG", `${subject} ${leads} ${shown}, which isn't an official government domain.`)
        : {
            ...base,
            status: "UNVERIFIED",
            strength: "NONE",
            reason: `${shown} isn't a domain we recognize.`,
            sourceId: null,
          };
    case "SHORTENER":
      return {
        ...base,
        status: "UNVERIFIED",
        strength: "SOFT",
        reason: `${subject} is a shortened link (${shown}), so its real destination is hidden. Enveloppe doesn't open it; use the official website instead.`,
        sourceId: null,
        officialAlternative: webAlternative,
      };
    case "MALFORMED":
      return { ...base, status: "UNVERIFIED", strength: "NONE", reason: "We couldn't read this address.", sourceId: null };
  }
}

function paymentDraft(method: PaymentMethod, sourceText: string, reg: Registry, agency: AgencyEntry | undefined): Draft {
  const label = METHOD_LABEL[method];
  const base = { claimType: "payment" as const, letterValue: label.charAt(0).toUpperCase() + label.slice(1), evidenceType: "TRUST_REGISTRY" as const };
  if (!agency) {
    return { ...base, evidenceType: "NONE", status: "UNVERIFIED", strength: "NONE", reason: "We don't have payment rules for this sender.", sourceId: null };
  }
  const viaListedProvider = reg.domains.some(
    (d) => d.role === "AUTHORIZED_THIRD_PARTY" && d.agencyId === agency.code && sourceText.toLowerCase().includes(d.ownerLabel.toLowerCase()),
  );
  const rule = paymentRule(reg, agency.code, method);

  // "Never demands X" rules win, unless the letter points to the agency's own listed provider for X.
  const demandRule = scamRulesFor(reg, agency.code, "demands_payment_method").find((r) => r.methods?.includes(method));
  if (demandRule && !(viaListedProvider && rule?.verdict === "ACCEPTED_VIA_THIRD_PARTY")) {
    return { ...base, status: "VERIFIED_CONTRADICTION", strength: "HARD", reason: demandRule.statement, sourceId: demandRule.sourceId };
  }
  const phoneRule = scamRulesFor(reg, agency.code, "payment_by_phone")[0];
  if (phoneRule && /\b(by|over the|via)\s+(tele)?phone\b|\bcall\b/i.test(sourceText)) {
    return { ...base, status: "VERIFIED_CONTRADICTION", strength: "HARD", reason: phoneRule.statement, sourceId: phoneRule.sourceId };
  }
  if (!rule) {
    return { ...base, status: "UNVERIFIED", strength: "NONE", reason: `We don't have a rule for paying ${agency.shortName} by ${label}.`, sourceId: null };
  }
  switch (rule.verdict) {
    case "NEVER_USED":
      return { ...base, status: "VERIFIED_CONTRADICTION", strength: "HARD", reason: `${agency.shortName} doesn't accept ${label}.`, sourceId: rule.sourceId };
    case "ACCEPTED":
      return { ...base, status: "VERIFIED_MATCH", strength: "STRONG", reason: `${agency.shortName} accepts payment by ${label}.`, sourceId: rule.sourceId };
    case "ACCEPTED_VIA_THIRD_PARTY":
      return {
        ...base,
        status: "VERIFIED_MATCH",
        strength: "SOFT",
        reason: `${agency.shortName} accepts ${label} only through a third-party provider it lists on canada.ca${rule.notes ? ` (${rule.notes.replace(/\.$/, "")})` : ""}. Start the payment from canada.ca, never from a link or number in a letter.`,
        sourceId: rule.sourceId,
      };
  }
}

function riskDrafts(x: Extraction, reg: Registry, agency: AgencyEntry | undefined): Draft[] {
  if (!x.riskSignals.length) return [];
  const out: Draft[] = [];
  const hard: typeof x.riskSignals = [];
  let hardRule: { statement: string; sourceId: string } | undefined;

  if (agency) {
    for (const s of x.riskSignals) {
      if (s.type !== "threat_arrest_or_police") continue;
      const text = s.sourceText.toLowerCase();
      const keywordRule = scamRulesFor(reg, agency.code, "threatens_arrest_or_deportation").find((r) =>
        r.keywords?.some((k) => new RegExp(`\\b${k}`, "i").test(text)),
      );
      const anyThreatRule = scamRulesFor(reg, agency.code, "threatens")[0];
      const rule = keywordRule ?? anyThreatRule;
      if (rule) {
        hard.push(s);
        hardRule ??= rule;
      }
    }
  }
  if (hardRule) {
    out.push({
      claimType: "risk_language",
      letterValue: hard[0].sourceText.slice(0, 120),
      status: "VERIFIED_CONTRADICTION",
      strength: "HARD",
      evidenceType: "TRUST_REGISTRY",
      reason: hardRule.statement,
      sourceId: hardRule.sourceId,
      boxes: hard.map((s) => s.box),
      quote: hard[0].sourceText,
      page: 1,
      lowConfidence: false,
    });
  }

  const soft = x.riskSignals.filter((s) => !hard.includes(s));
  if (soft.length) {
    const aggressive = agency ? scamRulesFor(reg, agency.code, "aggressive_language")[0] : undefined;
    const threatening = soft.some((s) => s.type === "threat_arrest_or_police");
    out.push({
      claimType: "risk_language",
      letterValue: soft.map((s) => s.sourceText).join(" · ").slice(0, 200),
      status: "VERIFIED_CONTRADICTION",
      strength: "SOFT",
      evidenceType: threatening && aggressive ? "TRUST_REGISTRY" : "NONE",
      reason:
        "Pressure tactics like extreme urgency and threats are common in impersonation scams." +
        (threatening && aggressive ? ` ${aggressive.statement}` : ""),
      sourceId: threatening && aggressive ? aggressive.sourceId : null,
      boxes: soft.map((s) => s.box),
      quote: soft[0].sourceText,
      page: 1,
      lowConfidence: false,
    });
  }
  return out;
}

function finalize(d: Draft, index: number, reg: Registry): VerificationItem {
  const source = d.sourceId ? sourceOf(reg, d.sourceId) : null;
  return {
    id: `${d.claimType}-${index}`,
    claimType: d.claimType,
    letterValue: d.letterValue.slice(0, 300),
    status: d.status,
    strength: d.strength,
    evidenceType: d.evidenceType,
    reason: d.reason.slice(0, 500),
    sourceId: source?.id ?? null,
    sourceUrl: source?.url ?? null,
    verifiedOn: source?.verifiedOn ?? null,
    officialAlternative: d.officialAlternative ?? null,
    highlight: {
      boxes: (d.boxes ?? []).filter((b): b is Box => b !== null),
      page: d.page ?? 1,
      quote: d.quote ?? null,
      lowConfidence: d.lowConfidence ?? false,
    },
  };
}

const STATUS_RANK: Record<VStatus, number> = {
  VERIFIED_CONTRADICTION: 0,
  NEEDS_USER_CONFIRMATION: 1,
  VERIFIED_MATCH: 2,
  UNVERIFIED: 3,
};
const STRENGTH_RANK: Record<VStrength, number> = { HARD: 0, STRONG: 1, SOFT: 2, NONE: 3 };
const CLAIM_RANK: ClaimType[] = [
  "reference", "phone", "qr", "url", "email", "payment", "form", "tax_year", "risk_language", "embedded_instruction", "agency",
];

/** Most serious first. Also used when the case module adds its own items. */
export function sortItems(items: VerificationItem[]): VerificationItem[] {
  return [...items].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      STRENGTH_RANK[a.strength] - STRENGTH_RANK[b.strength] ||
      CLAIM_RANK.indexOf(a.claimType) - CLAIM_RANK.indexOf(b.claimType),
  );
}
