-- Every nickname keeps its own guest person, so a link can be undone. Links confirmed before this migration have none yet.
UPDATE "identity"."person_alias" SET guest_person_id = person_id WHERE resolution <> 'confirmed';
--> statement-breakpoint
-- A merge accepts several Telegram accounts. When both persons have a record under the same unique key (the same game,
-- sign-up, rating and so on) the whole merge fails instead of dropping one of them. Only the membership of one community
-- and notification preferences are combined: the surviving person's record wins, active if either was active.
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

    UPDATE "org"."membership" kept SET status = 'active', left_at = NULL
    FROM "org"."membership" gone
    WHERE kept.person_id = p_into AND gone.person_id = p_from AND gone.community_id = kept.community_id AND gone.status = 'active';
    DELETE FROM "org"."membership" gone USING "org"."membership" kept
    WHERE gone.person_id = p_from AND kept.person_id = p_into AND kept.community_id = gone.community_id;
    DELETE FROM "comms"."notification_pref" gone USING "comms"."notification_pref" kept
    WHERE gone.person_id = p_from AND kept.person_id = p_into AND kept.channel = gone.channel AND kept.kind = gone.kind;

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
