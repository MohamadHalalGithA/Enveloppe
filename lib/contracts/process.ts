import { z } from "zod";
import { ActionTypeZ, AgencyCodeZ, CivilDateZ, DocTypeZ, RegistryIdZ } from "./common";

/** Blueprint Part 13. Processes are ordered JSON state machines in data/processes/*.json. */

export const ProcessIdZ = z.enum(["CRA_REVIEW", "CRA_OBJECTION", "IRCC_BIOMETRICS"]);
export type ProcessId = z.infer<typeof ProcessIdZ>;

export const ProcessDefinitionZ = z.object({
  id: ProcessIdZ,
  agencyId: AgencyCodeZ,
  title: z.string(),
  sourceId: RegistryIdZ,
  verifiedOn: CivilDateZ,
  stages: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        userAction: ActionTypeZ.optional(),
        expectNext: z.string().optional(),
        terminal: z.boolean().optional(),
      }),
    )
    .min(2),
  /** docType → stage it places the case in (forward-only). */
  triggers: z.partialRecord(DocTypeZ, z.string()),
  /** stage → stage after the user saves submission proof. */
  afterSubmit: z.record(z.string(), z.string()),
});
export type ProcessDefinition = z.infer<typeof ProcessDefinitionZ>;

export const ProcessViewZ = z.object({
  processId: ProcessIdZ,
  title: z.string(),
  currentStageId: z.string(),
  stages: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      state: z.enum(["done", "current", "todo"]),
      expectNext: z.string().optional(),
    }),
  ),
  sourceUrl: z.url(),
});
export type ProcessView = z.infer<typeof ProcessViewZ>;
