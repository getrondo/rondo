-- Old rename events held the new name. The events stay, the names go; one statement, so the log is never left open.
DO $$
BEGIN
    ALTER TABLE "audit"."log" DISABLE TRIGGER "audit_log_append_only_trg";
    UPDATE "audit"."log" SET diff = NULLIF(diff - 'displayName', '{}'::jsonb) WHERE action = 'person.rename' AND diff ? 'displayName';
    ALTER TABLE "audit"."log" ENABLE TRIGGER "audit_log_append_only_trg";
END;
$$;
