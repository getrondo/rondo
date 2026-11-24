CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "venue"."booking" ADD CONSTRAINT "booking_no_overlap_ex" EXCLUDE USING gist ("field_id" WITH =, "during" WITH &&) WHERE ("status" <> 'released');
--> statement-breakpoint
ALTER TABLE "finance"."price_rule" ADD CONSTRAINT "price_rule_no_overlap_ex" EXCLUDE USING gist ("community_id" WITH =, "scope" WITH =, (coalesce("scope_id", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =, "applies_to" WITH =, (coalesce("headcount", 'empty'::int4range)) WITH =, "valid" WITH &&);
--> statement-breakpoint
CREATE FUNCTION "finance"."assert_txn_balanced"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    total bigint;
BEGIN
    SELECT coalesce(sum("amount_cents"), 0) INTO total FROM "finance"."ledger_entry" WHERE "txn_id" = NEW."txn_id";
    IF total <> 0 THEN
        RAISE EXCEPTION 'ledger transaction % is unbalanced by % cents', NEW."txn_id", total USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ledger_entry_balanced_trg" AFTER INSERT OR UPDATE ON "finance"."ledger_entry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "finance"."assert_txn_balanced"();
--> statement-breakpoint
CREATE FUNCTION "audit"."forbid_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ledger_entry_append_only_trg" BEFORE UPDATE OR DELETE ON "finance"."ledger_entry" FOR EACH ROW EXECUTE FUNCTION "audit"."forbid_mutation"();
--> statement-breakpoint
CREATE TRIGGER "signup_event_append_only_trg" BEFORE UPDATE OR DELETE ON "scheduling"."signup_event" FOR EACH ROW EXECUTE FUNCTION "audit"."forbid_mutation"();
--> statement-breakpoint
CREATE TRIGGER "audit_log_append_only_trg" BEFORE UPDATE OR DELETE ON "audit"."log" FOR EACH ROW EXECUTE FUNCTION "audit"."forbid_mutation"();
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rondo_app') THEN
        CREATE ROLE "rondo_app" NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rondo_admin') THEN
        CREATE ROLE "rondo_admin" NOLOGIN IN ROLE "rondo_app";
    END IF;
END;
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "identity", "org", "venue", "scheduling", "play", "finance", "feedback", "league", "community", "comms", "ingest", "audit" TO "rondo_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "identity", "org", "venue", "scheduling", "play", "finance", "feedback", "league", "community", "comms", "ingest" TO "rondo_app";
--> statement-breakpoint
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA "audit" TO "rondo_app";
--> statement-breakpoint
GRANT USAGE ON SCHEMA "play_private", "feedback_private" TO "rondo_admin";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "play_private", "feedback_private" TO "rondo_admin";
--> statement-breakpoint
CREATE FUNCTION "org"."current_community_id"() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.community_id', true), '')::uuid $$;
--> statement-breakpoint
DO $$
DECLARE
    target record;
BEGIN
    FOR target IN
        SELECT c.table_schema, c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.column_name = 'community_id' AND c.table_schema NOT IN ('audit', 'pg_catalog', 'information_schema')
    LOOP
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', target.table_schema, target.table_name);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I.%I TO rondo_app USING (community_id = org.current_community_id()) WITH CHECK (community_id = org.current_community_id())', target.table_schema, target.table_name);
    END LOOP;
END;
$$;
--> statement-breakpoint
ALTER TABLE "org"."community" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "org"."community" TO "rondo_app" USING ("id" = "org"."current_community_id"());
--> statement-breakpoint
CREATE SCHEMA "analytics";
--> statement-breakpoint
CREATE MATERIALIZED VIEW "analytics"."player_attendance" AS
SELECT s."community_id", a."person_id", date_part('year', s."local_date"::date)::int AS "year", count(*)::int AS "games", min(s."local_date") AS "first_game", max(s."local_date") AS "last_game"
FROM "scheduling"."attendance" a
JOIN "scheduling"."session" s ON s."id" = a."session_id"
WHERE a."outcome" IN ('attended', 'late', 'left_early') AND s."status" = 'played'
GROUP BY s."community_id", a."person_id", date_part('year', s."local_date"::date);
--> statement-breakpoint
CREATE UNIQUE INDEX "player_attendance_uq" ON "analytics"."player_attendance" ("community_id", "person_id", "year");
--> statement-breakpoint
CREATE MATERIALIZED VIEW "analytics"."venue_usage" AS
SELECT s."community_id", s."venue_id", extract(isodow FROM s."local_date"::date)::int AS "weekday", date_part('year', s."local_date"::date)::int AS "year", count(*) FILTER (WHERE s."status" = 'played')::int AS "played", count(*) FILTER (WHERE s."status" = 'cancelled')::int AS "cancelled"
FROM "scheduling"."session" s
GROUP BY s."community_id", s."venue_id", extract(isodow FROM s."local_date"::date), date_part('year', s."local_date"::date);
--> statement-breakpoint
CREATE UNIQUE INDEX "venue_usage_uq" ON "analytics"."venue_usage" ("community_id", coalesce("venue_id", '00000000-0000-0000-0000-000000000000'::uuid), "weekday", "year");
--> statement-breakpoint
CREATE MATERIALIZED VIEW "analytics"."community_monthly" AS
SELECT s."community_id", date_trunc('month', s."local_date"::date)::date AS "month", count(DISTINCT s."id") FILTER (WHERE s."status" = 'played')::int AS "sessions_played", count(DISTINCT s."id") FILTER (WHERE s."status" = 'cancelled')::int AS "sessions_cancelled", count(a."person_id")::int AS "attendances", count(DISTINCT a."person_id")::int AS "active_players"
FROM "scheduling"."session" s
LEFT JOIN "scheduling"."attendance" a ON a."session_id" = s."id"
GROUP BY s."community_id", date_trunc('month', s."local_date"::date);
--> statement-breakpoint
CREATE UNIQUE INDEX "community_monthly_uq" ON "analytics"."community_monthly" ("community_id", "month");
--> statement-breakpoint
CREATE FUNCTION "analytics"."refresh_all"() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    REFRESH MATERIALIZED VIEW "analytics"."player_attendance";
    REFRESH MATERIALIZED VIEW "analytics"."venue_usage";
    REFRESH MATERIALIZED VIEW "analytics"."community_monthly";
END;
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "analytics" TO "rondo_app";
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA "analytics" TO "rondo_app";
