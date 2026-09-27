CREATE TABLE "case_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_stage" text,
	"to_stage" text,
	"letter_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agency_id" text NOT NULL,
	"process_id" text,
	"stage_id" text,
	"title" text NOT NULL,
	"program" text,
	"period" text,
	"reference_hmac" text,
	"reference_last4" char(4),
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_status_chk" CHECK ("cases"."status" in ('ACTION_REQUIRED','SUBMITTED','WAITING_FOR_GOVERNMENT','NEEDS_REVIEW','CLOSED'))
);
--> statement-breakpoint
CREATE TABLE "letter_images" (
	"letter_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"bytes" "bytea" NOT NULL,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"delete_after" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"case_id" uuid,
	"case_role" text,
	"case_decision" text,
	"status" text NOT NULL,
	"image_sha256" char(64) NOT NULL,
	"doc_type" text,
	"issue_date" date,
	"title" text,
	"reference_hmac" text,
	"reference_last4" char(4),
	"reference_uncertain" boolean DEFAULT false NOT NULL,
	"extraction" jsonb,
	"qr_findings" jsonb,
	"case_match" jsonb,
	"verdict" text,
	"deadline" jsonb,
	"response_pack" jsonb,
	"summary" jsonb,
	"model_id" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"analyzed_at" timestamp with time zone,
	CONSTRAINT "letters_case_role_chk" CHECK ("letters"."case_role" is null or "letters"."case_role" in ('primary','suspected_imitation')),
	CONSTRAINT "letters_case_decision_chk" CHECK ("letters"."case_decision" is null or "letters"."case_decision" in ('LINKED','NEW_CASE','KEPT_SEPARATE'))
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"letter_id" uuid,
	"user_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"title" text NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"checklist" jsonb,
	"proof_confirmation" text,
	"proof_notes" text,
	"proof_submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_status_chk" CHECK ("tasks"."status" in ('OPEN','DONE'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth0_sub" text NOT NULL,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth0_sub_unique" UNIQUE("auth0_sub")
);
--> statement-breakpoint
CREATE TABLE "verification_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"letter_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"claim_type" text NOT NULL,
	"letter_value" text NOT NULL,
	"status" text NOT NULL,
	"strength" text NOT NULL,
	"evidence_type" text NOT NULL,
	"reason" text NOT NULL,
	"source_id" text,
	"source_url" text,
	"verified_on" date,
	"official_alternative" jsonb,
	"highlight" jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_clips" (
	"letter_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"lang" text NOT NULL,
	"text_sha256" char(64) NOT NULL,
	"audio" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_clips_letter_id_lang_text_sha256_pk" PRIMARY KEY("letter_id","lang","text_sha256")
);
--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_images" ADD CONSTRAINT "letter_images_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_images" ADD CONSTRAINT "letter_images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_items" ADD CONSTRAINT "verification_items_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_items" ADD CONSTRAINT "verification_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_clips" ADD CONSTRAINT "voice_clips_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_clips" ADD CONSTRAINT "voice_clips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_events_case_idx" ON "case_events" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "cases_user_agency_idx" ON "cases" USING btree ("user_id","agency_id");--> statement-breakpoint
CREATE INDEX "cases_user_ref_idx" ON "cases" USING btree ("user_id","reference_hmac");--> statement-breakpoint
CREATE UNIQUE INDEX "letters_user_sha_uq" ON "letters" USING btree ("user_id","image_sha256");--> statement-breakpoint
CREATE INDEX "letters_user_created_idx" ON "letters" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "letters_case_idx" ON "letters" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "tasks_user_status_due_idx" ON "tasks" USING btree ("user_id","status","due_date");--> statement-breakpoint
CREATE INDEX "verification_items_letter_idx" ON "verification_items" USING btree ("letter_id");