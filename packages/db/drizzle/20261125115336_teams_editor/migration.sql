CREATE TYPE "play"."lineup_delivery_status" AS ENUM('claimed', 'sent', 'uncertain', 'refused');--> statement-breakpoint
CREATE TABLE "play"."lineup_delivery" (
	"session_id" uuid,
	"chat_id" bigint,
	"topic_id" bigint,
	"message_id" bigint,
	"text" text,
	"status" "play"."lineup_delivery_status" NOT NULL,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lineup_delivery_pkey" PRIMARY KEY("session_id","chat_id")
);
--> statement-breakpoint
CREATE TABLE "play"."team_draft" (
	"session_id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"state" jsonb NOT NULL,
	"proposed_at" timestamp with time zone,
	"changed_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"publish_token" uuid,
	"publish_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "play_private"."rating_event" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "play"."team" ADD COLUMN "rank" smallint;--> statement-breakpoint
ALTER TABLE "scheduling"."signup" ADD COLUMN "is_guest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "play"."lineup_delivery" ADD CONSTRAINT "lineup_delivery_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play_private"."rating_event" ADD CONSTRAINT "rating_event_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "play"."team_draft" ADD CONSTRAINT "team_draft_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play"."team_draft" ADD CONSTRAINT "team_draft_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play"."team_draft" ADD CONSTRAINT "team_draft_updated_by_person_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "identity"."person"("id") ON DELETE SET NULL;