SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
-- No code of this release or the previous one reads or writes these tables. The lock keeps a row from appearing between the check and the drop.
DO $$
DECLARE
    unused text;
    has_row boolean;
BEGIN
    FOREACH unused IN ARRAY ARRAY[
        '"community"."ad"',
        '"community"."equipment"',
        '"community"."equipment_custody"',
        '"community"."event"',
        '"community"."event_rsvp"',
        '"community"."lost_item"',
        '"community"."rule_ack"',
        '"community"."rule_doc"',
        '"feedback"."feedback"',
        '"feedback_private"."incident"',
        '"feedback"."mvp_vote"',
        '"feedback_private"."peer_rating"',
        '"finance"."payment"',
        '"identity"."consent"',
        '"league"."award"',
        '"league"."fixture_availability"',
        '"league"."fixture_event"',
        '"league"."squad_member"',
        '"org"."activity_follow"',
        '"comms"."notification_pref"',
        '"comms"."outbox"',
        '"play"."format_rule"',
        '"play"."match_event"',
        '"scheduling"."checkpoint"',
        '"scheduling"."duty"',
        '"scheduling"."holiday"',
        '"scheduling"."logistics"',
        '"scheduling"."session_field"',
        '"scheduling"."weather_snapshot"',
        '"venue"."venue_closure"'
    ] LOOP
        EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE', unused);
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s)', unused) INTO has_row;
        IF has_row THEN
            RAISE EXCEPTION 'table % is not empty, it is not dropped', unused;
        END IF;
    END LOOP;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "identity"."merge_person"(p_from uuid, p_into uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    fk record;
BEGIN
    IF p_from = p_into THEN
        RAISE EXCEPTION 'cannot merge a person into itself';
    END IF;

    PERFORM 1 FROM "identity"."person" WHERE id IN (p_from, p_into) ORDER BY id FOR UPDATE;

    IF (SELECT count(*) FROM "identity"."person" WHERE id IN (p_from, p_into) AND merged_into_person_id IS NULL) <> 2 THEN
        RAISE EXCEPTION 'both persons must exist and not be merged already';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "play"."lineup_entry" one
        JOIN "play"."lineup_entry" two ON two.session_id = one.session_id AND two.person_id = p_into
        WHERE one.person_id = p_from
    ) THEN
        RAISE EXCEPTION 'both persons are in the same line-up';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "identity"."alias_link" one
        JOIN "identity"."alias_link" two ON two.alias_id = one.alias_id AND two.person_id = p_into AND two.during && one.during
        WHERE one.person_id = p_from AND one.status <> two.status
    ) THEN
        RAISE EXCEPTION 'contradicting nickname decisions';
    END IF;

    WITH decided AS (
        DELETE FROM "identity"."alias_link" WHERE person_id IN (p_from, p_into) RETURNING *
    )
    INSERT INTO "identity"."alias_link" (id, community_id, alias_id, person_id, during, method, status, decided_by, decided_at)
    SELECT gen_random_uuid(), community_id, alias_id, p_into, unnest(range_agg(during)),
           (array_agg(method ORDER BY decided_at DESC NULLS LAST))[1], status,
           (array_agg(decided_by ORDER BY decided_at DESC NULLS LAST))[1], max(decided_at)
    FROM decided GROUP BY community_id, alias_id, status;

    UPDATE "org"."membership" kept SET status = 'active', left_at = NULL
    FROM "org"."membership" gone
    WHERE kept.person_id = p_into AND gone.person_id = p_from AND gone.community_id = kept.community_id AND gone.status = 'active';
    DELETE FROM "org"."membership" gone USING "org"."membership" kept
    WHERE gone.person_id = p_from AND kept.person_id = p_into AND kept.community_id = gone.community_id;

    FOR fk IN
        SELECT ns.nspname AS schema_name, cls.relname AS table_name, att.attname AS column_name
        FROM pg_constraint con
        JOIN pg_class cls ON cls.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = cls.relnamespace
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
        WHERE con.contype = 'f'
          AND con.confrelid = '"identity"."person"'::regclass
          AND array_length(con.conkey, 1) = 1
          AND NOT (cls.oid = '"identity"."person"'::regclass AND att.attname = 'merged_into_person_id')
          AND NOT EXISTS (
              SELECT 1 FROM pg_trigger trg
              WHERE trg.tgrelid = cls.oid AND trg.tgfoid = '"audit"."forbid_mutation"'::regproc
          )
    LOOP
        EXECUTE format('UPDATE %I.%I SET %I = $1 WHERE %I = $2', fk.schema_name, fk.table_name, fk.column_name, fk.column_name)
        USING p_into, p_from;
    END LOOP;

    UPDATE "identity"."person" SET merged_into_person_id = p_into WHERE id = p_from;
END;
$$;
--> statement-breakpoint
ALTER TABLE "community"."equipment_custody" DROP CONSTRAINT "equipment_custody_equipment_id_equipment_id_fkey";--> statement-breakpoint
ALTER TABLE "community"."event_rsvp" DROP CONSTRAINT "event_rsvp_event_id_event_id_fkey";--> statement-breakpoint
ALTER TABLE "community"."rule_ack" DROP CONSTRAINT "rule_ack_rule_doc_id_rule_doc_id_fkey";--> statement-breakpoint
DROP TABLE "community"."ad";--> statement-breakpoint
DROP TABLE "community"."equipment";--> statement-breakpoint
DROP TABLE "community"."equipment_custody";--> statement-breakpoint
DROP TABLE "community"."event";--> statement-breakpoint
DROP TABLE "community"."event_rsvp";--> statement-breakpoint
DROP TABLE "community"."lost_item";--> statement-breakpoint
DROP TABLE "community"."rule_ack";--> statement-breakpoint
DROP TABLE "community"."rule_doc";--> statement-breakpoint
DROP TABLE "feedback"."feedback";--> statement-breakpoint
DROP TABLE "feedback_private"."incident";--> statement-breakpoint
DROP TABLE "feedback"."mvp_vote";--> statement-breakpoint
DROP TABLE "feedback_private"."peer_rating";--> statement-breakpoint
DROP TABLE "finance"."payment";--> statement-breakpoint
DROP TABLE "identity"."consent";--> statement-breakpoint
DROP TABLE "league"."award";--> statement-breakpoint
DROP TABLE "league"."fixture_availability";--> statement-breakpoint
DROP TABLE "league"."fixture_event";--> statement-breakpoint
DROP TABLE "league"."squad_member";--> statement-breakpoint
DROP TABLE "org"."activity_follow";--> statement-breakpoint
DROP TABLE "comms"."notification_pref";--> statement-breakpoint
DROP TABLE "comms"."outbox";--> statement-breakpoint
DROP TABLE "play"."format_rule";--> statement-breakpoint
DROP TABLE "play"."match_event";--> statement-breakpoint
DROP TABLE "scheduling"."checkpoint";--> statement-breakpoint
DROP TABLE "scheduling"."duty";--> statement-breakpoint
DROP TABLE "scheduling"."holiday";--> statement-breakpoint
DROP TABLE "scheduling"."logistics";--> statement-breakpoint
DROP TABLE "scheduling"."session_field";--> statement-breakpoint
DROP TABLE "scheduling"."weather_snapshot";--> statement-breakpoint
DROP TABLE "venue"."venue_closure";--> statement-breakpoint
DROP TYPE "community"."ad_status";--> statement-breakpoint
DROP TYPE "community"."equipment_kind";--> statement-breakpoint
DROP TYPE "community"."event_kind";--> statement-breakpoint
DROP TYPE "community"."lost_item_status";--> statement-breakpoint
DROP TYPE "feedback"."incident_kind";--> statement-breakpoint
DROP TYPE "feedback"."incident_status";--> statement-breakpoint
DROP TYPE "finance"."payment_method";--> statement-breakpoint
DROP TYPE "identity"."consent_purpose";--> statement-breakpoint
DROP TYPE "league"."availability";--> statement-breakpoint
DROP TYPE "league"."award_kind";--> statement-breakpoint
DROP TYPE "league"."fixture_event_kind";--> statement-breakpoint
DROP TYPE "org"."notify_level";--> statement-breakpoint
DROP TYPE "comms"."channel";--> statement-breakpoint
DROP TYPE "play"."match_event_kind";--> statement-breakpoint
DROP TYPE "scheduling"."checkpoint_kind";--> statement-breakpoint
DROP TYPE "scheduling"."checkpoint_state";--> statement-breakpoint
DROP TYPE "scheduling"."duty_kind";--> statement-breakpoint
DROP TYPE "scheduling"."holiday_kind";--> statement-breakpoint
DROP SCHEMA "community";
--> statement-breakpoint
DROP SCHEMA "feedback_private";
--> statement-breakpoint
DROP SCHEMA "feedback";
