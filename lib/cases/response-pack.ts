import type {
  ActionType,
  AgencyEntry,
  DeadlineResult,
  Extraction,
  ResponsePack,
  Verdict,
  VerificationItem,
} from "@/lib/contracts";
import { usable } from "@/lib/deadlines/rules";
import { processById } from "@/lib/processes/engine";
import type { Registry } from "@/lib/registry/load";
import { channelFor, contactById, officialContactFor } from "@/lib/registry/lookup";
import { formatCivilDate } from "@/lib/ui/format";
import { DOC_LABEL } from "./labels";

/**
 * Response Pack (Blueprint Part 14). Every channel, contact and form comes from the Trust Registry
 * (each carries a registryId); nothing the letter printed is ever offered as a way to respond.
 * Text is templated per action, never model free text. The user submits; we never submit for them.
 */

export interface PackInput {
  x: Extraction;
  registry: Registry;
  agency: AgencyEntry | undefined;
  verdict: Verdict;
  items: VerificationItem[];
  deadline: DeadlineResult;
  /** Process and stage the letter puts the case in (null when it isn't placed in a process). */
  placement: { processId: string; stageId: string } | null;
}

const byDate = (d: DeadlineResult) => (d.effective ? ` by ${formatCivilDate(d.effective)}` : "");

function actionFor(input: PackInput): ActionType | null {
  const { placement, x } = input;
  const stage = placement ? processById(placement.processId)?.stages.find((s) => s.id === placement.stageId) : undefined;
  if (stage?.userAction) return stage.userAction;
  const requested = x.requiredActions.find((a) => !a.needsConfirmation)?.actionType;
  return requested && requested !== "none" ? requested : null;
}

export function buildResponsePack(input: PackInput): ResponsePack | null {
  const { x, registry: reg, agency, verdict, deadline } = input;
  if (!agency) return null;
  const docType = x.documentType.value;
  const contact = officialContactFor(reg, agency.code, { program: usable(x.program), docType, title: x.documentType.rawTitle });
  if (!contact) return null;
  const officialContact = { registryId: contact.id, display: contact.display, label: contact.label, verifiedOn: contact.verifiedOn };
  const channel = docType ? channelFor(reg, docType) : undefined;
  const officialChannel =
    channel && channel.agencyId === agency.code
      ? { registryId: channel.id, name: channel.name, url: channel.url, kind: channel.kind, verifiedOn: channel.verifiedOn }
      : null;
  const formEntry = docType ? reg.forms.find((f) => f.agencyId === agency.code && f.usedFor.includes(docType)) : undefined;
  const form = formEntry ? { registryId: formEntry.id, code: formEntry.code, url: formEntry.url } : null;
  const completion = { status: "OPEN" as const, taskId: null, proof: null };

  if (verdict === "CONTRADICTIONS_FOUND") {
    const fraud = contactById(reg, "tel-cra-fraud");
    const hasQr = input.items.some((i) => i.claimType === "qr");
    return {
      summary: `Don't pay and don't contact anyone using the details in this letter. Check with ${agency.shortName} directly.`,
      action: { type: "call", label: `Check with ${agency.shortName} using the verified number` },
      deadline,
      requestedDocuments: [],
      officialChannel: null,
      officialContact,
      form: null,
      steps: [
        `Don't ${hasQr ? "scan the QR code, " : ""}call the number, or send any payment from this letter.`,
        `Call ${agency.shortName} at the verified number above and ask whether this letter is real and whether you owe anything.`,
        `You can also check your ${agency.shortName} account yourself: type canada.ca into your browser instead of using a link.`,
        agency.code === "CRA" && fraud
          ? `Keep the letter. You can report it to CRA's fraud line at ${fraud.display}.`
          : "Keep the letter. You can report it to the agency.",
      ],
      caution: "Don't use the contact details printed in this letter.",
      completion,
    };
  }

  const action = actionFor(input);
  const docs = x.requestedDocuments
    .filter((d) => d.value)
    .map((d) => ({ label: d.value!, sourceText: d.sourceText, checked: false }));
  const caution =
    verdict === "CANNOT_VERIFY"
      ? `We couldn't confirm this letter's details. Before acting, check with ${agency.shortName} using the official contact below.`
      : input.items.some((i) => i.status === "UNVERIFIED" && ["phone", "url", "email", "qr"].includes(i.claimType))
        ? "Some contact details in this letter aren't on our official lists. Use the official contact below instead."
        : input.items.some((i) => i.status === "VERIFIED_CONTRADICTION" && i.evidenceType === "CASE_FILE")
          ? "Some details don't match your existing case. Check with the agency if you're unsure."
          : null;
  const base = { deadline, requestedDocuments: docs, officialChannel, officialContact, form, caution, completion };
  const docLabel = DOC_LABEL[docType ?? "OTHER"].toLowerCase();

  switch (action) {
    case "submit_documents":
      return {
        ...base,
        summary: `Send the documents ${agency.shortName} asked for${byDate(deadline)}.`,
        action: { type: "submit_documents", label: "Send the requested documents" },
        steps: [
          "Gather the documents in the checklist.",
          officialChannel
            ? `Open ${officialChannel.name} (link above). Don't use links sent by email or text.`
            : `Send them the way the letter describes, after checking it with ${agency.shortName}.`,
          "Enter the case or reference number printed on your letter when asked.",
          "Upload the documents and submit.",
          "Save your confirmation number here so Enveloppe can track your case.",
        ],
      };
    case "file_objection":
      return {
        ...base,
        summary: `If you disagree with this ${docLabel}, you can file an objection${byDate(deadline)}. If you agree, you don't need to do anything.`,
        action: { type: "file_objection", label: "Decide whether to file an objection" },
        steps: [
          `Read the ${docLabel} and decide whether you disagree with it.`,
          `If you disagree, register a formal dispute in your ${agency.shortName} account${form ? `, or send form ${form.code}` : ""}.`,
          "Consider free help from a community tax clinic before the deadline.",
          "Save your confirmation or case number here.",
        ],
      };
    case "give_biometrics":
      return {
        ...base,
        summary: `Give your fingerprints and photo (biometrics)${byDate(deadline)}.`,
        action: { type: "give_biometrics", label: "Book your biometrics appointment" },
        steps: [
          "Find a collection point and book an appointment (link above) as soon as you can.",
          "Bring your biometric instruction letter and your valid passport.",
          "If you can't make it in time, tell IRCC through its web form before the letter expires.",
          "Save your appointment confirmation here.",
        ],
      };
    case "pay":
      return {
        ...base,
        summary: `This letter asks for a payment${byDate(deadline)}. Before paying, confirm the amount with ${agency.shortName}.`,
        action: { type: "pay", label: "Confirm, then pay through an official method" },
        steps: [
          `Call ${agency.shortName} at the official number above to confirm the amount.`,
          `Pay using a method ${agency.shortName} lists on canada.ca, starting from canada.ca yourself.`,
          "Save your payment confirmation here.",
        ],
      };
    default:
      return {
        ...base,
        summary: `We didn't find anything you need to do. If you're unsure, contact ${agency.shortName} using the official number.`,
        action: null,
        steps: [`Keep the letter with your ${agency.shortName} records.`],
      };
  }
}
