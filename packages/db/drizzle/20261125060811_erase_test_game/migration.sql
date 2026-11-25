-- Deleting a test game removes the sign-up events of its admins; the ledger and the audit log stay append-only.
CREATE OR REPLACE FUNCTION "audit"."forbid_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND TG_TABLE_SCHEMA = 'scheduling' AND TG_TABLE_NAME = 'signup_event' AND current_setting('rondo.erase_game', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION '% is append-only', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;
