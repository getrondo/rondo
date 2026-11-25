import { isNotEmptyArray } from '@rnw-community/shared';
import { telegramAccount } from '@rondo/db/schema/identity.schema';
import { Db } from '@rondo/db/service/db.service';
import { inArray } from 'drizzle-orm';
import * as Effect from 'effect/Effect';

import { resolveLocale } from '../i18n/locale';

export const recipientsOf = Effect.fn('Core.recipientsOf')(function* (tgUserIds: readonly bigint[]) {
    const db = yield* Db;
    const known = isNotEmptyArray(tgUserIds)
        ? yield* db
              .select({ tgUserId: telegramAccount.tgUserId, languageCode: telegramAccount.languageCode })
              .from(telegramAccount)
              .where(inArray(telegramAccount.tgUserId, [...tgUserIds]))
        : [];

    return tgUserIds.map(tgUserId => ({
        tgUserId,
        locale: resolveLocale(known.find(row => row.tgUserId === tgUserId)?.languageCode)
    }));
});
