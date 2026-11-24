ALTER TYPE "identity"."alias_resolution" ADD VALUE 'vote';--> statement-breakpoint
ALTER TABLE "identity"."person_alias" ADD COLUMN "guest_person_id" uuid;--> statement-breakpoint
ALTER TABLE "identity"."person_alias" ADD CONSTRAINT "person_alias_guest_person_id_person_id_fkey" FOREIGN KEY ("guest_person_id") REFERENCES "identity"."person"("id") ON DELETE SET NULL;