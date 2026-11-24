CREATE TYPE "identity"."alias_link_method" AS ENUM('vote', 'shared_vote', 'admin', 'owner_list');--> statement-breakpoint
CREATE TYPE "identity"."alias_link_status" AS ENUM('auto', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "comms"."imported_poll_kind" AS ENUM('participation', 'reserve', 'other');--> statement-breakpoint
CREATE TYPE "scheduling"."session_review" AS ENUM('unclear_cancellation');--> statement-breakpoint
CREATE TABLE "identity"."alias_link" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"alias_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"during" daterange NOT NULL,
	"method" "identity"."alias_link_method" NOT NULL,
	"confidence" numeric(3,2),
	"status" "identity"."alias_link_status" NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comms"."imported_poll" (
	"poll_id" text PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"session_id" uuid,
	"message_id" bigint NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"kind" "comms"."imported_poll_kind" NOT NULL,
	"answers" smallint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "play"."lineup_entry" ADD COLUMN "is_team_undecided" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduling"."session" ADD COLUMN "review_reason" "scheduling"."session_review";--> statement-breakpoint
ALTER TABLE "identity"."person_alias" DROP COLUMN "confidence";--> statement-breakpoint
CREATE INDEX "alias_link_alias_idx" ON "identity"."alias_link" ("alias_id");--> statement-breakpoint
CREATE INDEX "alias_link_person_idx" ON "identity"."alias_link" ("person_id");--> statement-breakpoint
CREATE INDEX "imported_poll_session_idx" ON "comms"."imported_poll" ("session_id");--> statement-breakpoint
CREATE INDEX "imported_poll_community_idx" ON "comms"."imported_poll" ("community_id");--> statement-breakpoint
ALTER TABLE "identity"."alias_link" ADD CONSTRAINT "alias_link_alias_id_person_alias_id_fkey" FOREIGN KEY ("alias_id") REFERENCES "identity"."person_alias"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "identity"."alias_link" ADD CONSTRAINT "alias_link_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "identity"."alias_link" ADD CONSTRAINT "alias_link_decided_by_person_id_fkey" FOREIGN KEY ("decided_by") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "comms"."imported_poll" ADD CONSTRAINT "imported_poll_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comms"."imported_poll" ADD CONSTRAINT "imported_poll_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE SET NULL;