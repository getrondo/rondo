CREATE TYPE "play"."entry_resolution" AS ENUM('account', 'handle', 'alias', 'vote', 'manual', 'guest');--> statement-breakpoint
CREATE TABLE "comms"."poll_vote" (
	"poll_id" text,
	"tg_user_id" bigint,
	"session_id" uuid,
	"choice" text NOT NULL,
	"voted_at" timestamp with time zone,
	CONSTRAINT "poll_vote_pkey" PRIMARY KEY("poll_id","tg_user_id")
);
--> statement-breakpoint
CREATE TABLE "play"."lineup_entry" (
	"id" uuid PRIMARY KEY,
	"session_id" uuid NOT NULL,
	"message_id" bigint NOT NULL,
	"team_ordinal" smallint NOT NULL,
	"position" smallint NOT NULL,
	"raw" text,
	"alias_id" uuid,
	"tg_user_id" bigint,
	"person_id" uuid,
	"guest_of_person_id" uuid,
	"resolved_by" "play"."entry_resolution" NOT NULL,
	"is_gk" boolean DEFAULT false NOT NULL,
	"is_newcomer" boolean DEFAULT false NOT NULL,
	CONSTRAINT "lineup_entry_player_ck" CHECK (num_nonnulls("person_id", "guest_of_person_id") = 1)
);
--> statement-breakpoint
DROP INDEX "identity"."telegram_account_person_uq";--> statement-breakpoint
CREATE INDEX "telegram_account_person_idx" ON "identity"."telegram_account" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_account_username_uq" ON "identity"."telegram_account" (lower("username")) WHERE "username" is not null;--> statement-breakpoint
CREATE INDEX "poll_vote_session_idx" ON "comms"."poll_vote" ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lineup_entry_position_uq" ON "play"."lineup_entry" ("session_id","team_ordinal","position");--> statement-breakpoint
CREATE INDEX "lineup_entry_alias_idx" ON "play"."lineup_entry" ("alias_id");--> statement-breakpoint
CREATE INDEX "lineup_entry_person_idx" ON "play"."lineup_entry" ("person_id");--> statement-breakpoint
ALTER TABLE "comms"."poll_vote" ADD CONSTRAINT "poll_vote_tg_user_id_telegram_account_tg_user_id_fkey" FOREIGN KEY ("tg_user_id") REFERENCES "identity"."telegram_account"("tg_user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comms"."poll_vote" ADD CONSTRAINT "poll_vote_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "play"."lineup_entry" ADD CONSTRAINT "lineup_entry_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play"."lineup_entry" ADD CONSTRAINT "lineup_entry_alias_id_person_alias_id_fkey" FOREIGN KEY ("alias_id") REFERENCES "identity"."person_alias"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "play"."lineup_entry" ADD CONSTRAINT "lineup_entry_tg_user_id_telegram_account_tg_user_id_fkey" FOREIGN KEY ("tg_user_id") REFERENCES "identity"."telegram_account"("tg_user_id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "play"."lineup_entry" ADD CONSTRAINT "lineup_entry_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "play"."lineup_entry" ADD CONSTRAINT "lineup_entry_guest_of_person_id_person_id_fkey" FOREIGN KEY ("guest_of_person_id") REFERENCES "identity"."person"("id") ON DELETE RESTRICT;