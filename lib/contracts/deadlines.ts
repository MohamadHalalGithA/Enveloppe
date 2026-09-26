import { z } from "zod";
import { AgencyCodeZ, BoxZ, CivilDateZ, RegistryIdZ, type AgencyCode, type CivilDate } from "./common";
import type { Extraction } from "./extraction";

/** Blueprint Part 12. Deadlines are computed by code, never by the model. */

export const DeadlineResultZ = z.object({
  /** The civil date "today" was when this was computed (America/Toronto). */
  asOf: CivilDateZ,
  printed: z
    .object({ date: CivilDateZ, sourceText: z.string().max(500), box: BoxZ.nullable() })
    .nullable(),
  computed: z
    .object({
      date: CivilDateZ,
      ruleId: z.string(),
      statutory: z.boolean(),
      explanation: z.string(),
      sourceUrl: z.url(),
      verifiedOn: CivilDateZ,
      assumptions: z.array(z.string()),
    })
    .nullable(),
  /** The date we act on: the earlier of printed and computed when both exist. */
  effective: CivilDateZ.nullable(),
  mismatch: z.boolean(),
  daysRemaining: z.number().int().nullable(),
  clockStartedOn: CivilDateZ.nullable(),
  status: z.enum(["OK", "SOON", "PASSED", "UNKNOWN"]),
  /** Extra plain-language context (e.g. "set by CRA in the letter", "falls on a holiday"). */
  note: z.string().nullable(),
});
export type DeadlineResult = z.infer<typeof DeadlineResultZ>;

export type RuleOutcome = NonNullable<DeadlineResult["computed"]>;

/** Implemented as pure TS modules in lib/deadlines/rules/*.ts. Rules are code, not prompts. */
export interface DeadlineRule {
  id: string;
  agencyId: AgencyCode;
  appliesTo(x: Extraction): boolean;
  calculate(x: Extraction, ctx: { today: CivilDate; answers?: Record<string, string> }): RuleOutcome | null;
  explanation: string;
  sourceId: z.infer<typeof RegistryIdZ>;
  verifiedOn: CivilDate;
  /** True only when grounded in legislation. */
  statutory: boolean;
}

export const DeadlineRuleMetaZ = z.object({
  id: z.string(),
  agencyId: AgencyCodeZ,
  sourceId: RegistryIdZ,
  verifiedOn: CivilDateZ,
  statutory: z.boolean(),
});
