CREATE TYPE "comms"."notice_status" AS ENUM('claimed', 'sent', 'refused', 'uncertain');--> statement-breakpoint
ALTER TYPE "org"."chat_purpose" ADD VALUE 'other';--> statement-breakpoint
CREATE TABLE "comms"."notice_delivery" (
	"action_id" uuid,
	"chat_id" bigint,
	"status" "comms"."notice_status" DEFAULT 'claimed'::"comms"."notice_status" NOT NULL,
	"message_id" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notice_delivery_pkey" PRIMARY KEY("action_id","chat_id")
);
--> statement-breakpoint
ALTER TABLE "org"."community" ADD COLUMN "approver_person_id" uuid;--> statement-breakpoint
ALTER TABLE "org"."community" ADD COLUMN "live_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "org"."telegram_chat" ADD COLUMN "is_posting" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org"."telegram_chat" ADD COLUMN "is_mentioning" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "comms"."pending_action" ADD COLUMN "approver_tg_user_id" bigint;--> statement-breakpoint
ALTER TABLE "org"."community" ADD CONSTRAINT "community_approver_person_id_person_id_fkey" FOREIGN KEY ("approver_person_id") REFERENCES "identity"."person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "comms"."notice_delivery" ADD CONSTRAINT "notice_delivery_action_id_pending_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "comms"."pending_action"("id") ON DELETE CASCADE;