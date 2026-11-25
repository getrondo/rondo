import { isDefined } from '@rnw-community/shared';
import { personAlias, telegramAccount } from '@rondo/db/schema/identity.schema';
import { Db } from '@rondo/db/service/db.service';
import { eq } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import type { Directory } from '../interface/directory.interface';

export const loadDirectory = Effect.fn('Core.loadDirectory')(function* (communityId: string) {
    const db = yield* Db;
    const accounts = yield* db.select().from(telegramAccount);
    const aliases = yield* db.select().from(personAlias).where(eq(personAlias.communityId, communityId));

    return {
        personIdByAccount: new Map(
            accounts.flatMap(({ tgUserId, personId }) => (isDefined(personId) ? [[tgUserId, personId] as const] : []))
        ),
        accountByHandle: new Map(
            accounts.flatMap(({ tgUserId, username }) => (isDefined(username) ? [[username.toLowerCase(), tgUserId] as const] : []))
        ),
        aliasByNorm: new Map(aliases.map(alias => [alias.aliasNorm, alias]))
    } satisfies Directory;
});
