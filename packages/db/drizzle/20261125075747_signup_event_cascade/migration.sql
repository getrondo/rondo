-- A sign-up event may go only with its sign-up (a cascade from a deleted game); the ledger and the audit log stay append-only.
CREATE OR REPLACE FUNCTION "audit"."forbid_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND TG_TABLE_SCHEMA = 'scheduling' AND TG_TABLE_NAME = 'signup_event'
        AND NOT EXISTS (SELECT 1 FROM "scheduling"."signup" WHERE "id" = OLD."signup_id") THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION '% is append-only', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;
