import { z } from "zod";
import { ActionTypeZ, CivilDateZ, RegistryIdZ } from "./common";
import { DeadlineResultZ } from "./deadlines";

/**
 * Blueprint Part 14. Invariant: every channel/contact/form carries a registryId.
 * Contact details printed in a letter can never appear here.
 */

export const OfficialContactZ = z.object({
  registryId: RegistryIdZ,
  display: z.string(),
  label: z.string(),
  verifiedOn: CivilDateZ,
});

export const ResponsePackZ = z.object({
  summary: z.string(),
  action: z.object({ type: ActionTypeZ, label: z.string() }).nullable(),
  deadline: DeadlineResultZ,
  requestedDocuments: z.array(
    z.object({ label: z.string(), sourceText: z.string().nullable(), checked: z.boolean() }),
  ),
  officialChannel: z
    .object({
      registryId: RegistryIdZ,
      name: z.string(),
      url: z.url(),
      kind: z.enum(["portal", "mail", "in_person", "phone"]),
      verifiedOn: CivilDateZ,
    })
    .nullable(),
  officialContact: OfficialContactZ,
  form: z.object({ registryId: RegistryIdZ, code: z.string(), url: z.url() }).nullable(),
  /** Templated per action type and channel. No model free text. */
  steps: z.array(z.string()),
  caution: z.string().nullable(),
  completion: z.object({
    status: z.enum(["OPEN", "DONE"]),
    /** The tracked task for this action, once the letter is in a case (null before that). */
    taskId: z.uuid().nullable().default(null),
    proof: z
      .object({
        confirmationNumber: z.string().max(64).nullable(),
        submittedAt: z.iso.datetime(),
        notes: z.string().max(500).nullable(),
      })
      .nullable(),
  }),
});
export type ResponsePack = z.infer<typeof ResponsePackZ>;
