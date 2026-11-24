ALTER TABLE "identity"."alias_link" ADD CONSTRAINT "alias_link_community_fk" FOREIGN KEY ("community_id") REFERENCES "org"."community"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "identity"."alias_link" ADD CONSTRAINT "alias_link_no_overlap_ex" EXCLUDE USING gist ("alias_id" WITH =, "person_id" WITH =, "during" WITH &&);
--> statement-breakpoint
-- Turns links and undone links of the previous release into decisions. It can be run again: what that release decided meanwhile wins.
CREATE FUNCTION "identity"."backfill_alias_links"() RETURNS void LANGUAGE sql AS $$
    DELETE FROM "identity"."alias_link" link USING "identity"."person_alias" alias
    WHERE alias.id = link.alias_id AND link.during = '(,)' AND (
        (alias.resolution = 'confirmed' AND (link.status = 'approved') IS DISTINCT FROM (link.person_id = alias.person_id))
        OR (alias.resolution = 'guest' AND link.status = 'approved')
    );
    INSERT INTO "identity"."alias_link" (id, community_id, alias_id, person_id, during, method, status)
    SELECT gen_random_uuid(), community_id, id, person_id, '(,)', 'admin', 'approved' FROM "identity"."person_alias"
    WHERE resolution = 'confirmed' AND kind <> 'self' AND person_id IS NOT NULL
    ON CONFLICT DO NOTHING;
    INSERT INTO "identity"."alias_link" (id, community_id, alias_id, person_id, during, method, status, decided_by, decided_at)
    SELECT DISTINCT ON (alias.id, undone.person_id) gen_random_uuid(), alias.community_id, alias.id, undone.person_id, '(,)'::daterange, 'admin'::"identity"."alias_link_method", 'rejected'::"identity"."alias_link_status", undone.actor_person_id, undone.at
    FROM "identity"."person_alias" alias
    JOIN (
        SELECT entity_id, (diff ->> 'from')::uuid AS person_id, actor_person_id, at FROM "audit"."log"
        WHERE action = 'alias.unlink' AND diff ->> 'from' IS NOT NULL
    ) undone ON undone.entity_id = alias.id::text
    JOIN "identity"."person" ON person.id = undone.person_id
    WHERE alias.resolution = 'guest' AND undone.person_id IS DISTINCT FROM alias.guest_person_id
    ORDER BY alias.id, undone.person_id, undone.at DESC
    ON CONFLICT DO NOTHING;
$$;
--> statement-breakpoint
SELECT "identity"."backfill_alias_links"();
--> statement-breakpoint
-- A merge also moves nickname decisions: equal ones are united, and an approval against a rejection refuses the merge.
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
