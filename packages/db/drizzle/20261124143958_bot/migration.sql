CREATE TYPE "comms"."assistant_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "comms"."pending_action_status" AS ENUM('proposed', 'confirmed', 'rejected', 'expired', 'failed');--> statement-breakpoint
CREATE TABLE "comms"."assistant_message" (
	"id" uuid PRIMARY KEY,
	"tg_user_id" bigint NOT NULL,
	"role" "comms"."assistant_role" NOT NULL,
	"content" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comms"."pending_action" (
	"id" uuid PRIMARY KEY,
	"community_id" uuid NOT NULL,
	"requested_by_tg_user_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"summary" text NOT NULL,
	"status" "comms"."pending_action_status" DEFAULT 'proposed'::"comms"."pending_action_status" NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comms"."processed_update" (
	"update_id" bigint PRIMARY KEY,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comms"."telegram_poll" (
	"poll_id" text PRIMARY KEY,
	"chat_id" bigint NOT NULL,
	"message_id" bigint NOT NULL,
	"session_id" uuid NOT NULL,
	"options" jsonb NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity"."person" ADD COLUMN "merged_into_person_id" uuid;--> statement-breakpoint
CREATE INDEX "assistant_message_user_idx" ON "comms"."assistant_message" ("tg_user_id","at");--> statement-breakpoint
CREATE INDEX "pending_action_status_idx" ON "comms"."pending_action" ("status","expires_at");--> statement-breakpoint
CREATE INDEX "telegram_poll_session_idx" ON "comms"."telegram_poll" ("session_id");--> statement-breakpoint
ALTER TABLE "identity"."person" ADD CONSTRAINT "person_merged_into_person_id_person_id_fkey" FOREIGN KEY ("merged_into_person_id") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "comms"."pending_action" ADD CONSTRAINT "pending_action_community_id_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comms"."telegram_poll" ADD CONSTRAINT "telegram_poll_session_id_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scheduling"."session"("id") ON DELETE CASCADE;