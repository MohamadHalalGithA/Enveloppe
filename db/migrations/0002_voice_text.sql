ALTER TABLE "voice_clips" ALTER COLUMN "audio" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_clips" ADD COLUMN "text" text;