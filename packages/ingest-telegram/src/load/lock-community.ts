import { Db } from '@rondo/db/service/db.service';
import { sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

export const lockCommunity = Effect.fn('IngestTelegram.lockCommunity')(function* (communitySlug: string) {
    const db = yield* Db;

    yield* db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`rondo.community:${communitySlug}`}, 0))`);
});
