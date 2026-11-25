import { isNotEmptyArray } from '@rnw-community/shared';
import { telegramAccount } from '@rondo/db/schema/identity.schema';
import { Db } from '@rondo/db/service/db.service';
import { inArray, sql } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

export const releaseUsernames = Effect.fn('Core.releaseUsernames')(function* (usernames: readonly string[]) {
    const db = yield* Db;

    if (isNotEmptyArray(usernames)) {
        yield* db
            .update(telegramAccount)
            .set({ username: null })
            .where(
                inArray(
                    sql`lower(${telegramAccount.username})`,
                    usernames.map(name => name.toLowerCase())
                )
            );
    }
});
