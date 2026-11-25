import { telegramAccount } from '@rondo/db/schema/identity.schema';
import { desc, sql } from 'drizzle-orm';

import type { Database } from '@rondo/db/service/db.service';

export const primaryAccount = (db: Database, sessionId: string) => {
    const isKnown = sql`exists (
        select 1 from identity.telegram_author author join scheduling.session game on game.community_id = author.community_id
        where game.id = ${sessionId}::uuid and author.tg_user_id = ${telegramAccount.tgUserId})`;
    const isOnly = sql`not exists (
        select 1 from identity.telegram_account other
        where other.person_id = ${telegramAccount.personId} and other.tg_user_id <> ${telegramAccount.tgUserId})`;

    return db
        .selectDistinctOn([telegramAccount.personId], { personId: telegramAccount.personId, tgUserId: telegramAccount.tgUserId })
        .from(telegramAccount)
        .where(sql`(${isKnown} or ${isOnly})`)
        .orderBy(telegramAccount.personId, desc(isKnown), desc(telegramAccount.lastSeenAt))
        .as('primary_account');
};
