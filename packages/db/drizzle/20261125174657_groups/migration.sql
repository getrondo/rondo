ALTER TYPE "org"."chat_purpose" ADD VALUE 'other';--> statement-breakpoint
ALTER TABLE "org"."community" ADD COLUMN "approver_tg_user_id" bigint;--> statement-breakpoint
ALTER TABLE "org"."community" ADD COLUMN "live_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "org"."telegram_chat" ADD COLUMN "is_posting" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org"."telegram_chat" ADD COLUMN "is_mentioning" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "comms"."pending_action" ADD COLUMN "approver_tg_user_id" bigint;--> statement-breakpoint
ALTER TABLE "org"."community" ADD CONSTRAINT "community_approver_tg_user_id_telegram_account_tg_user_id_fkey" FOREIGN KEY ("approver_tg_user_id") REFERENCES "identity"."telegram_account"("tg_user_id") ON DELETE SET NULL;