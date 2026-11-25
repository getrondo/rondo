CREATE TYPE "play_private"."pair_kind" AS ENUM('together', 'apart');--> statement-breakpoint
CREATE TABLE "play_private"."pair_rule" (
	"community_id" uuid,
	"person_id" uuid,
	"other_person_id" uuid,
	"kind" "play_private"."pair_kind" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pair_rule_pkey" PRIMARY KEY("community_id","person_id","other_person_id"),
	CONSTRAINT "pair_rule_order_ck" CHECK ("person_id" < "other_person_id")
);
--> statement-breakpoint
CREATE TABLE "play"."team_draft" (
	"session_id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"state" jsonb NOT NULL,
	"proposed" jsonb,
	"private_text" text,
	"proposed_at" timestamp with time zone,
	"changed_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "play_private"."rating_event" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "play"."team" ADD COLUMN "rank" smallint;--> statement-breakpoint
ALTER TABLE "scheduling"."signup" ADD COLUMN "is_guest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "play_private"."pair_rule" ADD CONSTRAINT "pair_rule_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play_private"."pair_rule" ADD CONSTRAINT "pair_rule_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play_private"."pair_rule" ADD CONSTRAINT "pair_rule_other_person_id_person_id_fkey" FOREIGN KEY ("other_person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play_private"."pair_rule" ADD CONSTRAINT "pair_rule_created_by_person_id_fkey" FOREIGN KEY ("created_by") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "play_private"."rating_event" ADD CONSTRAINT "rating_event_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "play"."team_draft" ADD CONSTRAINT "team_draft_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play"."team_draft" ADD CONSTRAINT "team_draft_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play"."team_draft" ADD CONSTRAINT "team_draft_updated_by_person_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "identity"."person"("id") ON DELETE SET NULL;