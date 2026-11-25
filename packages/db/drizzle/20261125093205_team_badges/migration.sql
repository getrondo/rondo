-- 💷 is the red bib but was stored as orange. Renames the colour and the community config; squads keep pointing at the same row. It can be run again.
CREATE FUNCTION "play"."fix_money_colours"() RETURNS void LANGUAGE sql AS $$
    UPDATE "play"."team_color" color SET name = 'red'
    WHERE color.emoji = '💷' AND color.name = 'orange'
        AND NOT EXISTS (SELECT 1 FROM "play"."team_color" other WHERE other.community_id = color.community_id AND other.name = 'red');
    UPDATE "org"."community" SET settings = jsonb_set(settings, '{ingest,teamColors}', (
        SELECT jsonb_agg(CASE WHEN item.entry ->> 'emoji' = '💷' AND item.entry ->> 'name' = 'orange'
            THEN jsonb_set(item.entry, '{name}', '"red"') ELSE item.entry END ORDER BY item.position)
        FROM jsonb_array_elements(settings -> 'ingest' -> 'teamColors') WITH ORDINALITY AS item(entry, position)
    ))
    WHERE jsonb_typeof(settings -> 'ingest' -> 'teamColors') = 'array'
        AND settings -> 'ingest' -> 'teamColors' @> '[{"emoji": "💷", "name": "orange"}]'::jsonb;
$$;
--> statement-breakpoint
SELECT "play"."fix_money_colours"();
