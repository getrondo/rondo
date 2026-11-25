CREATE TABLE "comms"."poll_forward" (
	"poll_id" text,
	"chat_id" bigint,
	"message_id" bigint,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_forward_pkey" PRIMARY KEY("poll_id","chat_id")
);
--> statement-breakpoint
ALTER TABLE "comms"."poll_forward" ADD CONSTRAINT "poll_forward_poll_id_telegram_poll_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "comms"."telegram_poll"("poll_id") ON DELETE CASCADE;