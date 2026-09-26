import { getDomain, getPublicSuffix } from "tldts";
import type { OfficialDomain } from "@/lib/contracts";
import type { Registry } from "@/lib/registry/load";
import { matchDomain, scamRulesFor } from "@/lib/registry/lookup";

/**
 * Pure URL / email analysis (Blueprint Part 9, P0). Never fetches anything: letter-derived URLs are
 * hostile, and a verdict here comes only from parsing plus the Trust Registry allowlist.
 */

export type UrlVerdict =
  | "OFFICIAL"
  | "AUTHORIZED_THIRD_PARTY"
  | "LOOKALIKE"
  | "NOT_OFFICIAL"
  | "SHORTENER"
  | "UNSAFE_SCHEME"
  | "DISGUISED"
  | "IP_ADDRESS"
  | "HOMOGRAPH"
  | "FREE_EMAIL"
  | "MALFORMED";

export interface UrlAnalysis {
  input: string;
  verdict: UrlVerdict;
  host: string | null;
  /** eTLD+1, e.g. "canada.ca" or "cra-canada-verify.example". */
  registrableDomain: string | null;
  domainEntry: OfficialDomain | null;
  /** Government words the domain imitates (LOOKALIKE). */
  imitates: string[];
  /** For DISGUISED: what the link pretends to be. */
  pretendsToBe: string | null;
  scheme: string | null;
}

const MAX_INPUT = 2048;

const SHORTENERS = new Set([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rb.gy", "cutt.ly", "shorturl.at",
  "tiny.cc", "rebrand.ly", "s.id", "t.ly", "bl.ink", "lnkd.in", "qrco.de", "shorturl.gg",
]);

/** Words a scam domain borrows to look official. Deliberately not generic words like "tax". */
const GOV_WORDS = [
  "cra", "arc", "canada", "gc", "gov", "govt", "gouv", "ircc", "cic", "revenue", "ontario", "ottawa",
  "serviceontario", "servicecanada", "immigration", "receivergeneral",
];

/** Damerau-Levenshtein (optimal string alignment) distance. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function blank(input: string, verdict: UrlVerdict, extra: Partial<UrlAnalysis> = {}): UrlAnalysis {
  return {
    input,
    verdict,
    host: null,
    registrableDomain: null,
    domainEntry: null,
    imitates: [],
    pretendsToBe: null,
    scheme: null,
    ...extra,
  };
}

function trimPunctuation(s: string): string {
  return s.trim().replace(/^[\s<(["'`]+/, "").replace(/[\s>)\]"'`.,;:!?]+$/, "");
}

function imitatedWords(host: string, reg: Registry): string[] {
  const suffix = getPublicSuffix(host) ?? "";
  const withoutSuffix = suffix && host.endsWith(`.${suffix}`) ? host.slice(0, -(suffix.length + 1)) : host;
  const tokens = withoutSuffix.split(/[.\-_\d]+/).filter(Boolean);
  const found = new Set<string>();
  for (const t of tokens) if (GOV_WORDS.includes(t)) found.add(t);
  // Typo-squats of allowlisted names (canadda.ca, 0ntario...): only for longer labels to avoid noise.
  const officialLabels = reg.domains.map((d) => d.domain.split(".")[0]).filter((l) => l.length >= 5);
  for (const t of [...tokens, withoutSuffix.replace(/[.\-_]/g, "")]) {
    if (t.length < 5) continue;
    for (const l of officialLabels) {
      const dist = editDistance(t, l);
      if (dist > 0 && dist <= 2) found.add(l);
    }
  }
  return [...found];
}

function analyzeHost(input: string, host: string, reg: Registry, scheme: string | null): UrlAnalysis {
  host = host.toLowerCase().replace(/\.$/, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || /^[0-9a-f:]+$/.test(host) && host.includes(":")) {
    return blank(input, "IP_ADDRESS", { host, scheme });
  }
  const registrableDomain = getDomain(host) ?? host;
  const entry = matchDomain(reg, host);
  const base = { host, registrableDomain, scheme };
  if (entry) {
    return blank(input, entry.role === "GOVERNMENT" ? "OFFICIAL" : "AUTHORIZED_THIRD_PARTY", { ...base, domainEntry: entry });
  }
  if (host.split(".").some((l) => l.startsWith("xn--"))) return blank(input, "HOMOGRAPH", base);
  if (SHORTENERS.has(registrableDomain)) return blank(input, "SHORTENER", base);
  const imitates = imitatedWords(host, reg);
  if (imitates.length) return blank(input, "LOOKALIKE", { ...base, imitates });
  return blank(input, "NOT_OFFICIAL", base);
}

export function analyzeUrl(raw: string, reg: Registry): UrlAnalysis {
  const input = trimPunctuation(raw.slice(0, MAX_INPUT));
  if (!input) return blank(raw, "MALFORMED");

  // A scheme is letters/digits/+/- followed by ":" (a dot means it's a host like "canada.ca:443").
  const schemeMatch = /^([a-z][a-z0-9+-]*):/i.exec(input);
  let href = input;
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") return blank(input, "UNSAFE_SCHEME", { scheme });
  } else {
    href = `https://${input.replace(/^\/\//, "")}`;
  }

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return blank(input, "MALFORMED");
  }
  const scheme = url.protocol.replace(":", "");
  if (url.username || url.password) {
    return blank(input, "DISGUISED", {
      host: url.hostname,
      registrableDomain: getDomain(url.hostname) ?? url.hostname,
      pretendsToBe: decodeURIComponent(url.username),
      scheme,
    });
  }
  return analyzeHost(input, url.hostname, reg, scheme);
}

export function analyzeEmail(raw: string, reg: Registry, agency: Parameters<typeof scamRulesFor>[1]): UrlAnalysis {
  const input = trimPunctuation(raw.slice(0, MAX_INPUT)).replace(/^mailto:/i, "");
  const at = input.lastIndexOf("@");
  if (at < 1 || at === input.length - 1) return blank(input, "MALFORMED");
  const host = input.slice(at + 1).toLowerCase();
  const free = scamRulesFor(reg, agency, "free_email_domain").some((r) => r.domains?.includes(host));
  if (free) return blank(input, "FREE_EMAIL", { host, registrableDomain: getDomain(host) ?? host });
  return analyzeHost(input, host, reg, null);
}

/** Looks like a web address rather than free text (used for QR payloads). */
export function looksLikeUrl(s: string): boolean {
  return /^[a-z][a-z0-9+-]*:/i.test(s.trim()) || /^[\w-]+(\.[\w-]+)+(\/|$|\?|#)/.test(s.trim());
}
