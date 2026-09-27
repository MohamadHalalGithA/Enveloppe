import type { Box, CivilDate, Extraction, Field } from "@/lib/contracts";

/**
 * Contract Guard (Blueprint Part 6). Turns validated-but-untrusted model output into something the
 * deterministic pipeline can rely on. It can only lower confidence, never raise it.
 */

const MAX_STRING = 500;
const MAX_ARRAY = 50;

/** Before Zod: strip control characters, cap string lengths and array sizes. */
export function preSanitize(node: unknown): unknown {
  if (typeof node === "string") {
    return node.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, MAX_STRING);
  }
  if (Array.isArray(node)) return node.slice(0, MAX_ARRAY).map(preSanitize);
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, preSanitize(v)]));
  }
  return node;
}

// ---------- helpers ----------

const digits = (s: string) => s.replace(/\D/g, "");
const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function phoneDigits(s: string): string {
  const d = digits(s);
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

function hostOf(s: string): string {
  const t = s.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  return t.split(/[/?#@\s]/)[0].replace(/^www\./, "").replace(/\.$/, "");
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9,
  october: 10, november: 11, december: 12,
  janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, août: 8,
  septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

function civil(y: number, m: number, d: number): CivilDate | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** All dates written in `text`, plus whether a numeric date was ambiguous (day/month order). */
export function datesInText(text: string): { dates: CivilDate[]; ambiguous: boolean } {
  const dates = new Set<CivilDate>();
  let ambiguous = false;
  const push = (d: CivilDate | null) => d && dates.add(d);
  for (const m of text.matchAll(new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})`, "gi")))
    push(civil(+m[3], MONTHS[m[1].toLowerCase()], +m[2]));
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${MONTH_RE})\\.?,?\\s+(\\d{4})`, "gi")))
    push(civil(+m[3], MONTHS[m[2].toLowerCase()], +m[1]));
  for (const m of text.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) push(civil(+m[1], +m[2], +m[3]));
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g)) {
    const a = civil(+m[3], +m[1], +m[2]);
    const b = civil(+m[3], +m[2], +m[1]);
    push(a);
    push(b);
    if (a && b && a !== b) ambiguous = true;
  }
  return { dates: [...dates], ambiguous };
}

/** Canadian SIN: 9 digits (optionally grouped 3-3-3) passing the Luhn check. */
function isLuhn(d: string): boolean {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = +d[d.length - 1 - i];
    if (i % 2 === 1) n = n * 2 > 9 ? n * 2 - 9 : n * 2;
    sum += n;
  }
  return sum % 10 === 0;
}
const SIN_RE = /(?<![\d-])(\d{3})[ -]?(\d{3})[ -]?(\d{3})(?![\d-])/g;
export const REDACTED = "[REDACTED]";

export function redactSin(s: string): string {
  return s.replace(SIN_RE, (m, a, b, c) => (isLuhn(a + b + c) ? REDACTED : m));
}

// Injection = text addressed to software. Deliberately narrow: ordinary letter wording such as
// "report this amount as income" must never be flagged, because a flag is shown to the user as evidence.
const IGNORE_PREVIOUS =
  /\b(ignore|disregard|override|forget)\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier|preceding)\s+(instructions|prompts?|rules)/i;
const AI_AUDIENCE_CASED = /\b(AI|A\.I\.|LLMs?|GPT)\b/; // case-sensitive: avoids French "j'ai"
const AI_AUDIENCE = /\b(language\s+models?|chatgpt|gemini|automated\s+(systems?|processing|readers?|tools?|reviewers?))\b/i;
const IMPERATIVE = /\b(ignore|disregard|classify|mark|treat|label|flag|approve|override|pretend)\b/i;
const CONFIDENCE_TAMPERING = /\b(mark|set|report|treat)\b[^.]{0,60}\b(high\s+confidence|as\s+legitimate|as\s+verified)\b/i;

export function looksLikeInjection(s: string): boolean {
  if (IGNORE_PREVIOUS.test(s) || CONFIDENCE_TAMPERING.test(s)) return true;
  return (AI_AUDIENCE_CASED.test(s) || AI_AUDIENCE.test(s)) && IMPERATIVE.test(s);
}

/** "issueDate.value" and "issueDate" name the same field. */
function normalizePath(p: string): string {
  return p.replace(/\.(value|sourceText|box|page|confidence|needsConfirmation)$/, "").slice(0, 100);
}

function validBox(b: Box | null): Box | null {
  if (!b) return null;
  const [ymin, xmin, ymax, xmax] = b;
  if (!(ymin < ymax && xmin < xmax)) return null;
  const area = (ymax - ymin) * (xmax - xmin);
  if (area < 10 || area > 0.4 * 1_000_000) return null;
  return b;
}

// ---------- guard ----------

type Kind = "enum" | "date" | "ident" | "year" | "text" | "phone" | "url" | "email";

export interface GuardOptions {
  today: CivilDate;
}

export function guardExtraction(input: Extraction, opts: GuardOptions): Extraction {
  // Redact SIN-like strings everywhere before anything else looks at the data.
  const x = redactDeep(structuredClone(input)) as Extraction;
  const uncertain = new Set(x.uncertainFields.map(normalizePath));
  const todayYear = +opts.today.slice(0, 4);
  const poor = x.quality.legibility === "poor";

  const downgrade = (f: Field<unknown>, path: string) => {
    f.confidence = "low";
    f.needsConfirmation = true;
    uncertain.add(path);
  };

  const check = (f: Field<unknown>, path: string, kind: Kind) => {
    f.box = validBox(f.box);
    if (f.needsConfirmation) uncertain.add(path);
    if (poor) f.needsConfirmation = true;
    if (f.value === null) return;

    const src = f.sourceText ?? "";
    if (!src) return downgrade(f, path);
    if (looksLikeInjection(src)) return downgrade(f, path);

    switch (kind) {
      case "phone": {
        const v = phoneDigits(String(f.value));
        if (v.length < 3 || !phoneDigits(src).includes(v)) downgrade(f, path);
        break;
      }
      case "ident":
        if (!alnum(src).includes(alnum(String(f.value)))) downgrade(f, path);
        break;
      case "url":
      case "email": {
        const host = kind === "email" ? String(f.value).split("@").pop()!.toLowerCase() : hostOf(String(f.value));
        if (!host || !src.toLowerCase().includes(host)) downgrade(f, path);
        break;
      }
      case "year": {
        const y = Number(f.value);
        if (y < 2000 || y > todayYear + 2) {
          f.value = null;
          downgrade(f, path);
        } else if (!src.includes(String(y))) downgrade(f, path);
        break;
      }
      case "date": {
        const v = String(f.value);
        const y = +v.slice(0, 4);
        if (y < 2000 || y > todayYear + 2) {
          f.value = null;
          downgrade(f, path);
          break;
        }
        const { dates, ambiguous } = datesInText(src);
        if (!dates.includes(v)) downgrade(f, path);
        else if (ambiguous) {
          f.needsConfirmation = true;
          uncertain.add(path);
        }
        break;
      }
      case "enum":
      case "text":
        break;
    }
  };

  check(x.agency, "agency", "enum");
  check(x.documentType, "documentType", "enum");
  check(x.issueDate, "issueDate", "date");
  x.printedDeadlines.forEach((f, i) => check(f, `printedDeadlines[${i}]`, "date"));
  x.identifiers = x.identifiers.filter(
    (f) => !(f.value && (f.value.includes(REDACTED) || (f.kind === "other" && f.value.length > 30))),
  );
  x.identifiers.forEach((f, i) => check(f, `identifiers[${i}]`, "ident"));
  check(x.taxYear, "taxYear", "year");
  check(x.program, "program", "text");
  x.phones.forEach((f, i) => check(f, `phones[${i}]`, "phone"));
  x.urls.forEach((f, i) => check(f, `urls[${i}]`, "url"));
  x.emails.forEach((f, i) => check(f, `emails[${i}]`, "email"));
  x.paymentRequests.forEach((f, i) => check(f, `paymentRequests[${i}]`, "text"));
  x.requiredActions.forEach((f, i) => check(f, `requiredActions[${i}]`, "text"));
  x.requestedDocuments.forEach((f, i) => check(f, `requestedDocuments[${i}]`, "text"));
  x.formNumbers.forEach((f, i) => check(f, `formNumbers[${i}]`, "ident"));

  x.qrCodes = x.qrCodes.map((q) => ({ ...q, box: validBox(q.box) }));
  x.riskSignals = x.riskSignals.map((r) => ({ ...r, box: validBox(r.box) }));
  x.embeddedInstructions = x.embeddedInstructions.map((e) => ({ ...e, box: validBox(e.box) }));

  // Defense in depth: flag instruction-like text the model quoted anywhere but didn't report.
  const reported = new Set(x.embeddedInstructions.map((e) => e.sourceText));
  for (const q of collectQuotes(x)) {
    if (looksLikeInjection(q.text) && !reported.has(q.text)) {
      x.embeddedInstructions.push({ sourceText: q.text, box: q.box });
      reported.add(q.text);
    }
  }

  x.uncertainFields = [...uncertain];

  // The model's self-rated legibility can only be lowered: it has rated a blurry photo "good" while
  // flagging fields it couldn't read. Image problems or uncertain fields mean the letter wasn't fully read.
  if (x.quality.legibility === "good" && (x.quality.issues.some((i) => DEGRADING_ISSUES.has(i)) || hasReadingUncertainty(x))) {
    x.quality.legibility = "partial";
  }
  return x;
}

const DEGRADING_ISSUES = new Set(["blur", "glare", "cropped", "missing_pages", "low_resolution"]);
/** Doubts about which kind of letter it is, not about text we failed to read. */
const CLASSIFICATION_FIELDS = new Set(["documentType", "agency"]);

/** Some printed text couldn't be read with confidence (classification doubts don't count). */
export function hasReadingUncertainty(x: Extraction): boolean {
  return x.uncertainFields.some((p) => !CLASSIFICATION_FIELDS.has(p));
}

function redactDeep(node: unknown): unknown {
  if (typeof node === "string") return redactSin(node);
  if (Array.isArray(node)) return node.map(redactDeep);
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, redactDeep(v)]));
  }
  return node;
}

function collectQuotes(x: Extraction): { text: string; box: Box | null }[] {
  const out: { text: string; box: Box | null }[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (typeof o.sourceText === "string") out.push({ text: o.sourceText, box: (o.box as Box | null) ?? null });
    Object.values(o).forEach(visit);
  };
  const { embeddedInstructions: _skip, ...rest } = x;
  void _skip;
  visit(rest);
  return out;
}
