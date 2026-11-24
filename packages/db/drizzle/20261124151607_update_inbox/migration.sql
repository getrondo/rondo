ALTER TABLE "comms"."processed_update" ADD COLUMN "attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "comms"."processed_update" ADD COLUMN "done_at" timestamp with time zone;