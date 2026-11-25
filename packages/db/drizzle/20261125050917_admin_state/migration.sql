CREATE TABLE "comms"."admin_state" (
	"tg_user_id" bigint PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"message_id" bigint,
	"revision" integer DEFAULT 0 NOT NULL,
	"awaiting" text,
	"draft" jsonb DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "venue"."venue" ADD COLUMN "map_url" text;--> statement-breakpoint
ALTER TABLE "comms"."admin_state" ADD CONSTRAINT "admin_state_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;