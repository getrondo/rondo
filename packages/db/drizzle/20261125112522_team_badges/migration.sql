-- 💷 is the red bib but was stored as orange: the colour and the community config are renamed, squads keep pointing at the same row;
-- where red already exists, the squads move to it and the 💷 orange row goes
UPDATE "play"."team_color" color SET name = 'red'
WHERE color.emoji = '💷' AND color.name = 'orange'
    AND NOT EXISTS (SELECT 1 FROM "play"."team_color" other WHERE other.community_id = color.community_id AND other.name = 'red');
--> statement-breakpoint
UPDATE "play"."team" squad SET color_id = red.id
FROM "play"."team_color" money, "play"."team_color" red
WHERE squad.color_id = money.id AND money.emoji = '💷' AND money.name = 'orange'
    AND red.community_id = money.community_id AND red.name = 'red';
--> statement-breakpoint
DELETE FROM "play"."team_color" money USING "play"."team_color" red
WHERE money.emoji = '💷' AND money.name = 'orange' AND red.community_id = money.community_id AND red.name = 'red';
--> statement-breakpoint
UPDATE "org"."community" SET settings = jsonb_set(settings, '{ingest,teamColors}', (
    SELECT jsonb_agg(CASE WHEN item.entry ->> 'emoji' = '💷' AND item.entry ->> 'name' = 'orange'
        THEN jsonb_set(item.entry, '{name}', '"red"') ELSE item.entry END ORDER BY item.position)
    FROM jsonb_array_elements(settings -> 'ingest' -> 'teamColors') WITH ORDINALITY AS item(entry, position)
))
WHERE jsonb_typeof(settings -> 'ingest' -> 'teamColors') = 'array'
    AND settings -> 'ingest' -> 'teamColors' @> '[{"emoji": "💷", "name": "orange"}]'::jsonb;
