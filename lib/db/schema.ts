import { sql } from "drizzle-orm";
import {
  bigserial,
  char,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Blueprint Part 15. user_id is denormalized onto every child table so every query can be
// scoped with a single predicate. Registry + process definitions live in data/, not here.
// Not stored by design: full letter text, raw model output, SIN, full reference numbers, email.

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  auth0Sub: text("auth0_sub").notNull().unique(),
  preferredLanguage: text("preferred_language").notNull().default("en"),
  createdAt: createdAt(),
});

export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    agencyId: text("agency_id").notNull(),
    processId: text("process_id"),
    stageId: text("stage_id"),
    title: text("title").notNull(),
    program: text("program"),
    period: text("period"),
    /** HMAC(REF_HMAC_KEY, normalized reference). Never the raw reference. */
    referenceHmac: text("reference_hmac"),
    referenceLast4: char("reference_last4", { length: 4 }),
    status: text("status").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cases_user_agency_idx").on(t.userId, t.agencyId),
    index("cases_user_ref_idx").on(t.userId, t.referenceHmac),
    check(
      "cases_status_chk",
      sql`${t.status} in ('ACTION_REQUIRED','SUBMITTED','WAITING_FOR_GOVERNMENT','NEEDS_REVIEW','CLOSED')`,
    ),
  ],
);

export const letters = pgTable(
  "letters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    caseRole: text("case_role"),
    status: text("status").notNull(),
    imageSha256: char("image_sha256", { length: 64 }).notNull(),
    /** Validated + redacted Extraction (lib/contracts/extraction.ts). */
    extraction: jsonb("extraction"),
    caseMatch: jsonb("case_match"),
    verdict: text("verdict"),
    deadline: jsonb("deadline"),
    responsePack: jsonb("response_pack"),
    explanation: jsonb("explanation"),
    modelId: text("model_id"),
    errorCode: text("error_code"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("letters_user_sha_uq").on(t.userId, t.imageSha256),
    index("letters_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("letters_case_idx").on(t.caseId),
    check("letters_case_role_chk", sql`${t.caseRole} is null or ${t.caseRole} in ('primary','suspected_imitation')`),
  ],
);

export const letterImages = pgTable("letter_images", {
  letterId: uuid("letter_id")
    .primaryKey()
    .references(() => letters.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  bytes: bytea("bytes").notNull(),
  mime: text("mime").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  deleteAfter: timestamp("delete_after", { withTimezone: true }).notNull(),
});

export const verificationItems = pgTable(
  "verification_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    letterId: uuid("letter_id")
      .notNull()
      .references(() => letters.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    claimType: text("claim_type").notNull(),
    letterValue: text("letter_value").notNull(),
    status: text("status").notNull(),
    strength: text("strength").notNull(),
    evidenceType: text("evidence_type").notNull(),
    reason: text("reason").notNull(),
    sourceId: text("source_id"),
    sourceUrl: text("source_url"),
    verifiedOn: date("verified_on"),
    officialAlternative: jsonb("official_alternative"),
    highlight: jsonb("highlight").notNull(),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [index("verification_items_letter_idx").on(t.letterId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    letterId: uuid("letter_id").references(() => letters.id, { onDelete: "set null" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    actionType: text("action_type").notNull(),
    title: text("title").notNull(),
    dueDate: date("due_date"),
    status: text("status").notNull().default("OPEN"),
    checklist: jsonb("checklist"),
    // Submission proof is 1:1 with a task, so it lives here.
    proofConfirmation: text("proof_confirmation"),
    proofNotes: text("proof_notes"),
    proofSubmittedAt: timestamp("proof_submitted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("tasks_user_status_due_idx").on(t.userId, t.status, t.dueDate),
    check("tasks_status_chk", sql`${t.status} in ('OPEN','DONE')`),
  ],
);

export const caseEvents = pgTable(
  "case_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    fromStage: text("from_stage"),
    toStage: text("to_stage"),
    letterId: uuid("letter_id"),
    createdAt: createdAt(),
  },
  (t) => [index("case_events_case_idx").on(t.caseId)],
);

export const voiceClips = pgTable(
  "voice_clips",
  {
    letterId: uuid("letter_id")
      .notNull()
      .references(() => letters.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    lang: text("lang").notNull(),
    textSha256: char("text_sha256", { length: 64 }).notNull(),
    audio: bytea("audio").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.letterId, t.lang, t.textSha256] })],
);
