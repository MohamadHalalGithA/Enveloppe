import type { CivilDate, LetterResult } from "@/lib/contracts";
import { speechLanguage } from "./languages";

/**
 * The spoken explanation (Blueprint Part 19). Built deterministically from the VERIFIED result, never from
 * the letter's text: no reference numbers, names, addresses, amounts or internal ids. Critical values
 * (deadline, days left, official phone) are placeholders filled in by code after any translation, so a
 * model can't mistranslate them.
 */

export const PLACEHOLDERS = ["{{DEADLINE}}", "{{DAYS}}", "{{PHONE}}"] as const;

export interface SpeechScript {
  /** English, with placeholders. */
  template: string;
  values: { DEADLINE?: CivilDate; DAYS?: number; PHONE?: string };
}

const MAX_PART = 200;
const clip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, MAX_PART);

/** "Claims to be from the Canada Revenue Agency (CRA)" → { name, short }. */
function agencyNames(label: string): { name: string; short: string } {
  const m = /^(?:Claims to be from the )?(.+?) \(([^)]+)\)$/.exec(label);
  return m ? { name: m[1], short: m[2] } : { name: label, short: label };
}

export function buildSpeechScript(letter: LetterResult): SpeechScript {
  const { name, short } = agencyNames(letter.whatIsThis.agencyLabel);
  const [docKind, about] = letter.whatIsThis.docTypeLabel.split(": ");
  const pack = letter.responsePack;
  const phone = letter.officialContact?.display;
  const values: SpeechScript["values"] = {};
  if (phone) values.PHONE = phone;
  const parts: string[] = [];

  if (letter.verdict === "CONTRADICTIONS_FOUND") {
    const has = (t: string) => letter.items.some((i) => i.claimType === t && i.status === "VERIFIED_CONTRADICTION");
    const donts = ["call the phone number", has("qr") && "scan the code", has("payment") && "send money"].filter(Boolean);
    parts.push(`This letter says it is from the ${clip(name)}. But several details in it do not match official information.`);
    parts.push(
      `Do not ${donts.length > 1 ? `${donts.slice(0, -1).join(", ")}, or ${donts.at(-1)}` : donts[0]} using anything in this letter.` +
        (phone ? ` If you are worried, call ${clip(short)} yourself at {{PHONE}}.` : ""),
    );
    return { template: parts.join(" "), values };
  }

  if (letter.verdict === "CANNOT_VERIFY") {
    parts.push("We could not check who sent this letter against official information.");
  } else {
    parts.push(`This is a ${clip(docKind.toLowerCase())} from the ${clip(name)}${about ? `, about the ${clip(about)}` : ""}.`);
  }

  const d = letter.deadline;
  if (d.status === "PASSED" && d.effective) {
    // An old letter: don't read out steps as if they were still open.
    values.DEADLINE = d.effective;
    parts.push("The deadline for this letter was {{DEADLINE}}. That date has passed.");
    if (pack?.action?.type === "file_objection") {
      parts.push("If you disagree with it, you can still ask for more time to object. The steps are on your screen.");
    }
    parts.push(phone ? `To ask what you can still do, call ${clip(short)} at {{PHONE}}.` : `To ask what you can still do, contact ${clip(short)}.`);
    return { template: parts.join(" "), values };
  }

  switch (pack?.action?.type) {
    case "submit_documents": {
      const docs = pack.requestedDocuments.slice(0, 3).map((d) => clip(d.label.toLowerCase()));
      parts.push(
        `${clip(short)} is asking you to send some documents${docs.length ? `: ${docs.join(", and ")}` : ""}.` +
          (pack.officialChannel ? ` Send them through ${clip(pack.officialChannel.name)}.` : ""),
      );
      break;
    }
    case "file_objection":
      parts.push("If you disagree with it, you can file an objection. If you agree, you do not need to do anything.");
      break;
    case "give_biometrics":
      parts.push("You need to give your fingerprints and a photo. Book an appointment soon, and bring this letter and your passport.");
      break;
    case "pay":
      parts.push(`This letter asks for a payment. Before you pay, call ${clip(short)} to confirm the amount.`);
      break;
    default:
      parts.push("You do not need to do anything right now.");
  }

  if (d.effective && d.daysRemaining !== null) {
    values.DEADLINE = d.effective;
    values.DAYS = d.daysRemaining;
    parts.push("The deadline is {{DEADLINE}}. That is {{DAYS}} days from today.");
  }
  if (phone) parts.push(`If you have questions, call ${clip(short)} at {{PHONE}}.`);
  return { template: parts.join(" "), values };
}

/** Fills placeholders with values formatted for the language (dates and numbers by the locale, not a model). */
export function fillScript(template: string, values: SpeechScript["values"], lang: string): string {
  const locale = speechLanguage(lang)?.locale ?? "en-CA";
  let out = template;
  if (values.DEADLINE) {
    const [y, m, day] = values.DEADLINE.split("-").map(Number);
    const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, day)));
    out = out.replaceAll("{{DEADLINE}}", date);
  }
  if (values.DAYS !== undefined) out = out.replaceAll("{{DAYS}}", new Intl.NumberFormat(locale).format(values.DAYS));
  if (values.PHONE) out = out.replaceAll("{{PHONE}}", values.PHONE);
  return out;
}

/**
 * Last line of defense before text leaves for the voice service: drop emails, web addresses and any long
 * digit run (reference or account numbers) except the official phone number we put there ourselves.
 */
export function scrubForSpeech(text: string, allowedPhones: string[] = []): string {
  const allowed = new Set(allowedPhones.map((p) => p.replace(/\D/g, "")));
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "")
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, "")
    .replace(/(?:\p{Nd}[\s\-–.]?){5,}\p{Nd}?/gu, (m) => (allowed.has(m.replace(/\D/g, "")) ? m : ""))
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Placeholders a text contains, for checking a translation kept all of them. */
export function placeholdersIn(text: string): string[] {
  return PLACEHOLDERS.filter((p) => text.includes(p)).sort();
}
