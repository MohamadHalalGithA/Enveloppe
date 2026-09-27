import { ExtractionZ, type Extraction, type Field } from "@/lib/contracts";
import fixtureA from "@/demo/fixtures/letter-a-cra-review.extraction.json";
import fixtureB from "@/demo/fixtures/letter-b-cra-twin.extraction.json";

/** Synthetic extractions for tests (same shapes Gemini returns after the guard). */

export const letterA = (): Extraction => ExtractionZ.parse(structuredClone(fixtureA));
export const letterB = (): Extraction => ExtractionZ.parse(structuredClone(fixtureB));

function field<T>(value: T | null, sourceText: string | null, extra: Partial<Field<T>> = {}): Field<T> {
  return { value, sourceText, box: [100, 100, 120, 400], page: 1, confidence: "high", needsConfirmation: false, ...extra };
}

/** A CRA notice of reassessment (Sample C shape). */
export function noticeOfReassessment(opts: { issueDate: string; taxYear: number; ref?: string }): Extraction {
  const x = letterA();
  x.documentType = { ...field("CRA_NOTICE_OF_REASSESSMENT" as const, "Notice of reassessment"), rawTitle: "Notice of reassessment" };
  x.issueDate = field(opts.issueDate, opts.issueDate);
  x.taxYear = field(opts.taxYear, `Tax year: ${opts.taxYear}`);
  x.program = field("Income tax", "income tax and benefit return");
  x.printedDeadlines = [];
  x.requestedDocuments = [];
  x.requiredActions = [];
  x.identifiers = [{ ...field(opts.ref ?? "2023-T1-8841-2210", `Reference: ${opts.ref ?? "2023-T1-8841-2210"}`), kind: "reference_number" }];
  x.phones = [{ ...field("1-800-959-8281", "1-800-959-8281"), context: null }];
  x.urls = [{ ...field("canada.ca/my-cra-account", "canada.ca/my-cra-account"), context: null }];
  return x;
}

/** An IRCC biometric instruction letter (Sample D shape). */
export function irccBiometricsLetter(issueDate: string): Extraction {
  const x = letterA();
  x.agency = { ...field("IRCC" as const, "Immigration, Refugees and Citizenship Canada"), claimedName: "Immigration, Refugees and Citizenship Canada" };
  x.documentType = { ...field("IRCC_BIOMETRICS_INSTRUCTION" as const, "Biometric Instruction Letter"), rawTitle: "Biometric Instruction Letter" };
  x.issueDate = field(issueDate, issueDate);
  x.taxYear = field<number>(null, null);
  x.program = field<string>(null, null);
  x.printedDeadlines = [{ ...field<string>(null, "within 30 days of the date of this letter"), kind: "appointment_by", relativeDays: 30 }];
  x.identifiers = [{ ...field("E00012-3456", "Application number: E00012-3456"), kind: "application_number" }];
  x.phones = [{ ...field("1-888-242-2100", "1-888-242-2100"), context: null }];
  x.urls = [{ ...field("ircc.canada.ca", "ircc.canada.ca"), context: null }];
  x.requestedDocuments = [];
  x.requiredActions = [{ ...field("Give biometrics", "You must give your biometrics"), actionType: "give_biometrics" }];
  return x;
}
