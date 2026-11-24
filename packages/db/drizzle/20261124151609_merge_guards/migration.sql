-- Lock both persons, and refuse merges that would drop a Telegram account or append-only sign-up history.
CREATE OR REPLACE FUNCTION "identity"."merge_person"(p_from uuid, p_into uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    fk record;
    target record;
BEGIN
    IF p_from = p_into THEN
        RAISE EXCEPTION 'cannot merge a person into itself';
    END IF;

    PERFORM 1 FROM "identity"."person" WHERE id IN (p_from, p_into) ORDER BY id FOR UPDATE;

    IF (SELECT count(*) FROM "identity"."person" WHERE id IN (p_from, p_into) AND merged_into_person_id IS NULL) <> 2 THEN
        RAISE EXCEPTION 'both persons must exist and not be merged already';
    END IF;

    IF (SELECT count(*) FROM "identity"."telegram_account" WHERE person_id IN (p_from, p_into)) > 1 THEN
        RAISE EXCEPTION 'both persons have a Telegram account';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "scheduling"."signup" one
        JOIN "scheduling"."signup" two ON two.session_id = one.session_id AND two.person_id = p_into
        WHERE one.person_id = p_from
    ) THEN
        RAISE EXCEPTION 'both persons signed up for the same game';
    END IF;

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
        FOR target IN EXECUTE format('SELECT ctid FROM %I.%I WHERE %I = $1', fk.schema_name, fk.table_name, fk.column_name) USING p_from
        LOOP
            BEGIN
                EXECUTE format('UPDATE %I.%I SET %I = $1 WHERE ctid = $2', fk.schema_name, fk.table_name, fk.column_name) USING p_into, target.ctid;
            EXCEPTION WHEN unique_violation THEN
                EXECUTE format('DELETE FROM %I.%I WHERE ctid = $1', fk.schema_name, fk.table_name) USING target.ctid;
            END;
        END LOOP;
    END LOOP;

    UPDATE "identity"."person" SET merged_into_person_id = p_into WHERE id = p_from;
END;
$$;
