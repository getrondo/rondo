CREATE TABLE "play_private"."home_colour" (
	"person_id" uuid,
	"activity_id" uuid,
	"colour" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "home_colour_pkey" PRIMARY KEY("person_id","activity_id")
);
--> statement-breakpoint
ALTER TABLE "play_private"."home_colour" ADD CONSTRAINT "home_colour_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "identity"."person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "play_private"."home_colour" ADD CONSTRAINT "home_colour_activity_id_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "org"."activity"("id") ON DELETE CASCADE;