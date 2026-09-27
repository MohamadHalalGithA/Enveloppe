import { z } from "zod";
import {
  CivilDateZ,
  ExtractionZ,
  type CivilDate,
  type Extraction,
  type LetterResult,
} from "@/lib/contracts";
import { pickReference } from "@/lib/cases/reference";
import { loadLetterResult } from "@/lib/cases/result";
import { fileAnalyzedLetter } from "@/lib/cases/service";
import {
  claimForAnalysis,
  getLetterImage,
  getLetterImageInfo,
  getLetterRow,
  markLetterFailed,
} from "@/lib/db/repo";
import type { Db } from "@/lib/db/types";
import { ConflictError, NotFoundError, PipelineError } from "@/lib/errors";
import type { ExtractResult } from "@/lib/gemini/extract";
import { findQrCodes, type QrFinding } from "@/lib/qr/decode";
import type { Registry } from "@/lib/registry/load";

/**
 * The analysis pipeline (Blueprint Part 5):
 *   stored image → Gemini reading (injected) → Contract Guard → server QR decoding → Trust Registry
 *   verification → case threading → deadline → process → Response Pack → persisted → LetterResult.
 * Everything after the reading is deterministic. The reader is injected so tests and the demo can
 * supply a cached reading without changing any other step.
 */

export interface PipelineDeps {
  extract: (image: Buffer) => Promise<Pick<ExtractResult, "extraction" | "modelId">>;
  today: () => CivilDate;
  refKey: string;
  now?: () => Date;
  registry?: Registry;
  /** Demo only: a saved reading for this exact uploaded file (see cached-reading.ts). */
  cachedReading?: (imageSha256: string) => Promise<Pick<ExtractResult, "extraction" | "modelId"> | null>;
  /** "fallback": use the saved reading only if the reader fails; "offline": prefer it. */
  cachedMode?: "fallback" | "offline";
}

/** A PROCESSING claim older than this is treated as crashed and can be retried. */
const STALE_CLAIM_MS = 2 * 60 * 1000;

const ANALYZED = new Set(["SUCCESS", "PARTIAL_SUCCESS", "NEEDS_CONFIRMATION", "LOW_CONFIDENCE", "VERIFICATION_INCOMPLETE"]);

/** Statuses that have a full stored result. */
export function isAnalyzed(status: string): boolean {
  return ANALYZED.has(status);
}

export function imageUrl(letterId: string) {
  return `/api/letters/${letterId}/image`;
}

export async function letterResultFor(db: Db, userId: string, letterId: string, now: Date, registry?: Registry): Promise<LetterResult> {
  const info = await getLetterImageInfo(db, userId, letterId, now);
  return loadLetterResult(db, userId, letterId, {
    image: info ? { url: imageUrl(letterId), width: info.width, height: info.height } : null,
    registry,
  });
}

/** Idempotent: an analyzed letter returns its stored result without calling the reader again. */
export async function analyzeLetter(db: Db, userId: string, letterId: string, deps: PipelineDeps): Promise<LetterResult> {
  const now = deps.now?.() ?? new Date();
  const letter = await getLetterRow(db, userId, letterId);
  if (!letter) throw new NotFoundError("Letter");
  if (ANALYZED.has(letter.status)) return letterResultFor(db, userId, letterId, now, deps.registry);

  const image = await getLetterImage(db, userId, letterId, now);
  if (!image) throw new NotFoundError("Letter image");
  if (image === "expired") throw new ConflictError("IMAGE_EXPIRED", "This letter's image was deleted after 30 days. Upload it again.");

  if (!(await claimForAnalysis(db, userId, letterId, now, new Date(now.getTime() - STALE_CLAIM_MS)))) {
    throw new ConflictError("ALREADY_PROCESSING", "This letter is already being analyzed");
  }

  let reading: Pick<ExtractResult, "extraction" | "modelId"> | null =
    deps.cachedReading && deps.cachedMode === "offline" ? await deps.cachedReading(letter.imageSha256) : null;
  if (!reading) {
    try {
      reading = await deps.extract(image.bytes);
    } catch (e) {
      // Demo fallback: a saved reading of this exact sample file, clearly badged as cached.
      reading = deps.cachedReading ? await deps.cachedReading(letter.imageSha256) : null;
      if (!reading) {
        const code = e instanceof PipelineError ? e.code : "SERVICE_UNAVAILABLE";
        await markLetterFailed(db, userId, letterId, code === "SERVICE_UNAVAILABLE" ? "SERVICE_UNAVAILABLE" : "FAILED", code);
        throw e instanceof PipelineError ? e : new PipelineError("SERVICE_UNAVAILABLE");
      }
    }
  }

  // QR decoding is valuable but not critical: if it fails, the result is marked partial, not lost.
  const degraded: LetterResult["degraded"] = [];
  let qr: QrFinding[] = [];
  try {
    qr = await findQrCodes(image.bytes, reading.extraction.qrCodes);
  } catch {
    degraded.push("QR");
    qr = reading.extraction.qrCodes.map((q) => ({ ...q, decoded: null }));
  }

  await fileAnalyzedLetter(
    db,
    userId,
    letterId,
    { extraction: reading.extraction, qr, modelId: reading.modelId, degraded },
    { today: deps.today(), refKey: deps.refKey, registry: deps.registry },
  );
  return letterResultFor(db, userId, letterId, now, deps.registry);
}

/** Fields the user may correct after checking their paper letter. Nothing else is accepted. */
export const ConfirmFieldsZ = z
  .object({
    issueDate: CivilDateZ.optional(),
    printedDeadline: CivilDateZ.optional(),
    taxYear: z.number().int().min(2000).max(2100).optional(),
    reference: z
      .string()
      .trim()
      .min(4)
      .max(40)
      .regex(/^[A-Za-z0-9 ./-]+$/, "Letters, digits, spaces, dots, slashes and dashes only")
      .optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, "Confirm at least one field");
export type ConfirmFields = z.infer<typeof ConfirmFieldsZ>;

const confirmed = <T>(f: Extraction["issueDate"] | Extraction["taxYear"], value: T) => ({
  ...f,
  value,
  confidence: "high" as const,
  needsConfirmation: false,
});

/**
 * The user confirmed or corrected uncertain fields: apply them and re-run every deterministic stage
 * (no second model call). Only for letters not yet filed in a case.
 */
export async function confirmLetterFields(
  db: Db,
  userId: string,
  letterId: string,
  input: unknown,
  deps: Omit<PipelineDeps, "extract">,
): Promise<LetterResult> {
  const fields = ConfirmFieldsZ.parse(input);
  const now = deps.now?.() ?? new Date();
  const row = await getLetterRow(db, userId, letterId);
  if (!row) throw new NotFoundError("Letter");
  if (!row.extraction || !ANALYZED.has(row.status)) throw new ConflictError("NOT_ANALYZED", "This letter hasn't been analyzed yet");
  if (row.caseId) throw new ConflictError("ALREADY_FILED", "This letter is already in a case");

  const x = ExtractionZ.parse(row.extraction);
  const resolved = new Set<string>();
  if (fields.issueDate) {
    x.issueDate = { ...confirmed(x.issueDate, fields.issueDate), sourceText: x.issueDate.sourceText ?? fields.issueDate };
    resolved.add("issueDate");
  }
  if (fields.printedDeadline) {
    const [first, ...rest] = x.printedDeadlines;
    x.printedDeadlines = [
      first
        ? { ...first, value: fields.printedDeadline, relativeDays: null, confidence: "high", needsConfirmation: false }
        : { value: fields.printedDeadline, sourceText: fields.printedDeadline, box: null, page: 1, confidence: "high", needsConfirmation: false, kind: "respond_by", relativeDays: null },
      ...rest,
    ];
    resolved.add("printedDeadlines[0]");
  }
  if (fields.taxYear) {
    x.taxYear = { ...confirmed(x.taxYear, fields.taxYear), sourceText: x.taxYear.sourceText ?? String(fields.taxYear) };
    resolved.add("taxYear");
  }
  let reference: { digest: { hmac: string; last4: string } | null; uncertain: boolean } | undefined = {
    digest: row.referenceHmac && row.referenceLast4 ? { hmac: row.referenceHmac, last4: row.referenceLast4 } : null,
    uncertain: row.referenceUncertain,
  };
  if (fields.reference) {
    const picked = pickReference(x);
    const index = picked ? x.identifiers.indexOf(picked.field) : -1;
    const entry = {
      value: fields.reference,
      sourceText: fields.reference,
      box: picked?.field.box ?? null,
      page: picked?.field.page ?? 1,
      confidence: "high" as const,
      needsConfirmation: false,
      kind: picked?.field.kind ?? ("reference_number" as const),
    };
    if (index >= 0) {
      x.identifiers[index] = entry;
      resolved.add(`identifiers[${index}]`);
    } else {
      x.identifiers.unshift(entry);
    }
    reference = undefined; // digest the value the user typed
  }
  x.uncertainFields = x.uncertainFields.filter((p) => !resolved.has(p));

  await fileAnalyzedLetter(
    db,
    userId,
    letterId,
    {
      extraction: x,
      qr: (row.qrFindings as QrFinding[] | null) ?? [],
      modelId: row.modelId,
      degraded: ((row.summary as { degraded?: LetterResult["degraded"] } | null)?.degraded ?? []),
      reference,
    },
    { today: deps.today(), refKey: deps.refKey, registry: deps.registry },
  );
  return letterResultFor(db, userId, letterId, now, deps.registry);
}
