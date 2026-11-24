import { telegramAccount } from '@rondo/db/schema/identity.schema';
import { desc } from 'drizzle-orm';

import type { Database } from '@rondo/db/service/db.service';

export const primaryAccount = (db: Database) =>
    db
        .selectDistinctOn([telegramAccount.personId], { personId: telegramAccount.personId, tgUserId: telegramAccount.tgUserId })
        .from(telegramAccount)
        .orderBy(telegramAccount.personId, desc(telegramAccount.lastSeenAt))
        .as('primary_account');
