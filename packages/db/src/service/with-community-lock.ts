import { sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { Db } from './db.service';

type Community = { readonly id: string } | { readonly slug: string };

export const withCommunityLock = <Value, Failure, Requirements>(
    community: Community,
    effect: Effect.Effect<Value, Failure, Requirements>
) =>
    Effect.gen(function* () {
        const db = yield* Db;
        const slug = 'slug' in community ? sql`${community.slug}` : sql`(select slug from org.community where id = ${community.id}::uuid)`;

        return yield* db.transaction(() =>
            db.execute(sql`select pg_advisory_xact_lock(hashtextextended('rondo.community:' || ${slug}, 0))`).pipe(Effect.andThen(effect))
        );
    });
