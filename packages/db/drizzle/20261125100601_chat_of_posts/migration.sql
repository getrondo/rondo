ALTER TABLE "comms"."imported_poll" ADD COLUMN "chat_id" bigint;--> statement-breakpoint
ALTER TABLE "ingest"."source_ref" ADD COLUMN "chat_id" bigint;--> statement-breakpoint
ALTER TABLE "play"."lineup_entry" ADD COLUMN "chat_id" bigint;--> statement-breakpoint
DROP INDEX "ingest"."source_ref_message_kind_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "source_ref_message_kind_uq" ON "ingest"."source_ref" ("community_id",coalesce("chat_id", 0),"message_id","kind");